import type { Inputs } from './input.js';
import { debug, error, info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import { uploadChunks } from './uploadManager.js';
import { fileMetadata, loadFile } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import { BalenaAPI } from './api.js';
import { HTTPError } from 'ky';

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

const alreadyExistsError = (
	releaseId: number,
	assetKey: string,
	cause?: unknown,
) =>
	new Error(`A release asset for ${releaseId} - ${assetKey} already exists`, {
		cause,
	});

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

	private async streamUpload(metadata: FileMetadata): Promise<number> {
		debug(
			`File is smaller than ${MIN_MULTIPART_UPLOAD_SIZE}, uploading via stream upload`,
		);
		const { releaseId, assetKey } = this.params;
		const releaseAssetId = await this.api.getReleaseAssetId(
			releaseId,
			assetKey,
		);

		if (!this.params.overwrite && releaseAssetId != null) {
			throw alreadyExistsError(releaseId, assetKey);
		}

		if (releaseAssetId != null) {
			info('Release asset already exists, overriding...');
			await this.patchReleaseAsset(releaseAssetId, metadata);
		} else {
			debug('Release asset does not exist, creating a new one');
			await this.createReleaseAsset(metadata);
		}

		return await this.api.getUploadedReleaseAssetId(releaseId, assetKey);
	}

	private async assetForm(metadata: FileMetadata) {
		const asset = await loadFile(this.params.filePath, metadata);
		const form = new FormData();
		form.append('asset', asset, metadata.filename);
		return form;
	}

	private async patchReleaseAsset(
		releaseAssetId: number,
		metadata: FileMetadata,
	) {
		await this.api.request.patch(`v7/release_asset(${releaseAssetId})`, {
			body: await this.assetForm(metadata),
		});
	}

	private async createReleaseAsset(metadata: FileMetadata) {
		const { releaseId, assetKey, overwrite } = this.params;
		const form = await this.assetForm(metadata);
		form.append('asset_key', assetKey);
		form.append('release', `${releaseId}`);

		try {
			await this.api.request.post('v7/release_asset', {
				body: form,
			});
		} catch (e) {
			if (!(e instanceof HTTPError) || e.response.status !== 409) {
				throw e;
			}

			// The asset does exist, our existence check just read a replica that had
			// not caught up with the write that created it yet.
			if (!overwrite) {
				throw alreadyExistsError(releaseId, assetKey, e);
			}

			info('Release asset already exists, overriding...');
			const releaseAssetId = await this.api.getReleaseAssetIdAfterWrite(
				releaseId,
				assetKey,
			);
			await this.patchReleaseAsset(releaseAssetId, metadata);
		}
	}

	private async multipartUpload(metadata: FileMetadata): Promise<number> {
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

			await this.api.commitMultiPartUpload(
				releaseAssetId,
				uploadResponse.asset.uuid,
				providerCommitData,
			);

			return releaseAssetId;
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

	public async uploadFile(): Promise<number> {
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
