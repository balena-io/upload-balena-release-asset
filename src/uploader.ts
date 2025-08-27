import type { Inputs } from './input.js';
import { debug, error, info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import { uploadChunks } from './uploadManager.js';
import { fileMetadata, loadFile } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import { BalenaAPI, type OData } from './api.js';

const MIN_MULTIPART_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB

export type BeginReleaseAssetUpload = {
	asset: {
		uuid: string;
		uploadParts: webresources.UploadPart[];
	};
};

export type ProviderCommitPayload = {
	Parts: Array<{
		PartNumber: number;
		ETag: string;
	}>;
};

export type UploaderParams = Omit<Inputs, 'keyPrefix' | 'path'> & {
	assetKey: string;
	filePath: string;
};

export class ReleaseAssetUploader {
	private api: BalenaAPI;

	constructor(private readonly params: UploaderParams) {
		this.api = new BalenaAPI(this.params.balenaToken, this.params.balenaHost);
	}

	private async canUpdateRelease() {
		info(
			`Logged in to user ${JSON.stringify(await this.api.whoami(), null, 2)}`,
		);
		await this.api.canAccessRelease(this.params.releaseId);
		info(`Access to release ${this.params.releaseId} confirmed.`);
	}

	private async streamUpload(metadata: FileMetadata) {
		debug(
			`File is smaller than ${MIN_MULTIPART_UPLOAD_SIZE}, uploading via stream upload`,
		);
		const { releaseId, assetKey } = this.params;
		const releaseAssetId = await this.api.getReleaseAssetId(
			releaseId,
			assetKey,
		);

		if (!this.params.overwrite && releaseAssetId != null) {
			throw new Error(
				`A release asset for ${releaseId} - ${assetKey} already exists`,
			);
		}

		const asset = await loadFile(this.params.filePath, metadata);
		const form = new FormData();
		form.append('asset', asset, metadata.filename);

		if (releaseAssetId != null) {
			info('Release asset already exists, overriding...');
			await this.api.request.patch(`v7/release_asset(${releaseAssetId})`, {
				body: form,
			});
		} else {
			debug('Release asset does not exist, creating a new one');
			form.append('asset_key', assetKey);
			form.append('release', `${releaseId}`);
			await this.api.request.post('v7/release_asset', {
				body: form,
			});
		}

		const res = await this.api.request.get<
			OData<{ id: number; asset: { href: string } }>
		>(
			`v7/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id,asset`,
		);

		const body = await res.json();
		const {
			id,
			asset: { href: relaseAssetUrl },
		} = body.d![0];
		return { releaseAssetId: id, relaseAssetUrl };
	}

	private async multipartUpload(metadata: FileMetadata) {
		const { releaseId, assetKey, overwrite } = this.params;
		const releaseAssetId = await this.api.createOrGetReleaseAsset(
			releaseId,
			assetKey,
			overwrite,
		);
		const uploadResponse = await this.api.beginMultipartUpload(
			releaseAssetId,
			metadata,
			this.params.chunkSize,
		);

		try {
			const providerCommitData = await uploadChunks(
				uploadResponse.asset.uploadParts,
				this.params,
				metadata,
			);

			const asset = await this.api.commitMultiPartUpload(
				releaseAssetId,
				uploadResponse.asset.uuid,
				providerCommitData,
			);

			return {
				releaseAssetId,
				relaseAssetUrl: asset.href,
			};
		} catch (e) {
			error('Failed to upload parts or commit upload');
			error(e.message);
			error('Canceling upload');

			await this.api.cancelMultiPartUpload(
				releaseAssetId,
				uploadResponse.asset.uuid,
			);
			throw e;
		}
	}

	public async uploadFile(): Promise<{
		relaseAssetUrl: string;
		releaseAssetId: number;
	}> {
		await this.canUpdateRelease();
		const metadata = await fileMetadata(this.params.filePath);
		info(
			`Starting upload with key: ${this.params.assetKey} for ${JSON.stringify(metadata, null, 2)}`,
		);
		return metadata.size <= MIN_MULTIPART_UPLOAD_SIZE
			? await this.streamUpload(metadata)
			: await this.multipartUpload(metadata);
	}
}
