import type { Inputs } from './input.js';
import { debug, error, info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import { uploadChunks } from './uploadManager.js';
import { fileMetadata, loadFile } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import { BalenaAPI } from './api.js';

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
export class ReleaseAssetUploader {
	private api: BalenaAPI;
	private inputs: Inputs;

	constructor(inputs: Inputs) {
		this.inputs = inputs;
		this.api = new BalenaAPI(this.inputs.balenaToken, this.inputs.balenaHost);
	}

	private async canUpdateRelease() {
		info(
			`Logged in to user ${JSON.stringify(await this.api.whoami(), null, 2)}`,
		);
		await this.api.canAccessRlease(this.inputs.releaseId);
		info(`Access to release ${this.inputs.releaseId} confirmed.`);
	}

	private async streamUpload(metadata: FileMetadata) {
		debug(
			`File is smaller than ${MIN_MULTIPART_UPLOAD_SIZE}, uploading via stream upload`,
		);
		const { releaseId, assetKey } = this.inputs;
		const releaseAssetId = await this.api.getReleaseAssetId(
			releaseId,
			assetKey,
		);

		if (!this.inputs.overwrite && releaseAssetId != null) {
			throw new Error(
				`A release asset for ${releaseId} - ${assetKey} already exists`,
			);
		}

		const asset = await loadFile(this.inputs.filePath, metadata);
		const form = new FormData();
		form.append('asset', asset, metadata.filename);

		let res;
		if (releaseAssetId != null) {
			info('Release asset already exists, overriding...');
			res = await this.api.baseRequest(
				`/resin/release_asset(${releaseAssetId})`,
				{
					method: 'PATCH',
					body: form,
				},
			);
		} else {
			debug('Release asset does not exist, creating a new one');
			form.append('asset_key', assetKey);
			form.append('release', `${releaseId}`);
			res = await this.api.baseRequest('/resin/release_asset', {
				method: 'POST',
				body: form,
			});
		}

		if (!res.ok) {
			throw new Error('Faield to upload release');
		}

		res = await this.api.request(
			`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id,asset`,
		);

		if (!res.ok) {
			throw new Error(
				'Failed comunicating to balenaAPI after uploading release',
			);
		}

		const body = await res.json();
		const {
			id,
			asset: { href: relaseAssetUrl },
		} = body.d[0];
		return { releaseAssetId: id, relaseAssetUrl };
	}

	private async multipartUpload(metadata: FileMetadata) {
		const { releaseId, assetKey, overwrite } = this.inputs;
		const releaseAssetId = await this.api.createOrGetReleaseAsset(
			releaseId,
			assetKey,
			overwrite,
		);
		const uploadResponse = await this.api.beginMultipartUpload(
			releaseAssetId,
			metadata,
			this.inputs.chunkSize,
		);

		try {
			const providerCommitData = await uploadChunks(
				uploadResponse.asset.uploadParts,
				this.inputs,
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
		const metadata = await fileMetadata(this.inputs.filePath);
		return metadata.size <= MIN_MULTIPART_UPLOAD_SIZE
			? await this.streamUpload(metadata)
			: await this.multipartUpload(metadata);
	}
}
