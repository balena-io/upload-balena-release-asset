import { type BalenaSDK, getSdk } from 'balena-sdk';
import type { Inputs } from './input.js';
import { debug, info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import { uploadChunks } from './uploadManager.js';
import { fileMetadata, loadFile } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import type { WebResource } from 'balena-sdk/typings/pinejs-client-core.js';

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
export class BalenaAPI {
	private sdk: BalenaSDK;
	private inputs: Inputs;

	constructor(inputs: Inputs) {
		this.inputs = inputs;
		this.sdk = getSdk({
			isBrowser: false,
			dataDirectory: false,
			apiUrl: `https://api.${inputs.balenaHost}/`,
			// @ts-expect-error - use unstable API
			apiVersion: 'resin',
		});
	}

	public async init() {
		await this.sdk.auth.loginWithToken(this.inputs.balenaToken);
		// TODO: present a better error if it fails to login...
		info(
			`Logged in as ${JSON.stringify(await this.sdk.auth.whoami(), null, 2)}`,
		);
	}

	private async canUpdateRelease() {
		const res = await this.sdk.request.send({
			method: 'POST',
			url: `${this.sdk.pine.apiPrefix}release(${this.inputs.releaseId})/canAccess`,
			body: { action: 'update' },
		});

		if (res.statusCode !== 200 || res?.body?.d?.[0]?.id == null) {
			throw new Error('You do not have necessary access to this release');
		}

		info(`Access to release ${res.body.d[0].id} confirmed.`);
	}

	private async getReleaseAssetId(): Promise<number> {
		const sdkResult = (await this.sdk.pine.get({
			resource: 'release_asset',
			id: {
				asset_key: this.inputs.assetKey,
				release: this.inputs.releaseId,
			},
			// @ts-expect-error - use unstable API
			options: { $select: 'id' },
		})) as any;

		if (sdkResult?.id == null || !Number.isInteger(sdkResult.id)) {
			throw new Error(
				`Failed to get release_asset id for '${this.inputs.assetKey}' - ${this.inputs.releaseId}`,
			);
		}
		return sdkResult.id;
	}

	private async createEmptyReleaseAsset(): Promise<number> {
		try {
			const createdReleaseAsset = await this.sdk.pine.post({
				resource: 'release_asset',
				body: {
					asset_key: this.inputs.assetKey,
					release: this.inputs.releaseId,
				},
			});
			return createdReleaseAsset.id;
		} catch (err: any) {
			if (this.inputs.overwrite && err.statusCode === 409) {
				info(`Asset ${this.inputs.assetKey} already exists. Overwriting...`);
				return this.getReleaseAssetId();
			} else {
				throw err;
			}
		}
	}

	private async streamUpload(metadata: FileMetadata) {
		debug(
			`File is smaller than ${MIN_MULTIPART_UPLOAD_SIZE}, uploading via stream upload`,
		);
		let releaseAssetId: number | undefined;
		try {
			releaseAssetId = await this.getReleaseAssetId();
		} catch (err) {
			debug(`Release does not exist ${err}`);
			releaseAssetId = undefined;
		}

		if (!this.inputs.overwrite && releaseAssetId != null) {
			throw new Error(
				`A release asset for ${this.inputs.releaseId} - ${this.inputs.assetKey} already exists`,
			);
		}

		const asset = await loadFile(this.inputs.filePath, metadata);
		if (releaseAssetId != null) {
			info('Release asset already exists, overriding...');
			await this.sdk.pine.patch({
				resource: 'release_asset',
				id: releaseAssetId,
				body: { asset },
			});
		} else {
			debug('Release asset does not exist, creating a new one');
			await this.sdk.pine.post({
				resource: 'release_asset',
				body: {
					asset_key: this.inputs.assetKey,
					release: this.inputs.releaseId,
					asset,
				},
			});
		}
		const sdkResult = (await this.sdk.pine.get({
			resource: 'release_asset',
			id: {
				asset_key: this.inputs.assetKey,
				release: this.inputs.releaseId,
			},
			// @ts-expect-error - use unstable API
			options: { $select: ['id', 'asset'] },
		})) as unknown as { id: number; asset: WebResource };

		return {
			releaseAssetId: sdkResult.id,
			relaseAssetUrl: sdkResult.asset.href,
		};
	}

	private async beginMultipartUpload(
		releaseAssetId: number,
		metadata: FileMetadata,
	) {
		const res = (await this.sdk.request.send({
			method: 'POST',
			url: `${this.sdk.pine.apiPrefix}release_asset(${releaseAssetId})/beginUpload`,
			body: {
				asset: {
					filename: metadata.filename,
					content_type: metadata.contentType,
					size: metadata.size,
					chunk_size: this.inputs.chunkSize,
				},
			},
		})) as unknown as { body: BeginReleaseAssetUpload };
		return res.body;
	}

	private async commitMultiPartUpload(
		releaseAssetId: number,
		uuid: string,
		providerCommitData: ProviderCommitPayload,
	) {
		const res = (await this.sdk.request.send({
			method: 'POST',
			url: `${this.sdk.pine.apiPrefix}release_asset(${releaseAssetId})/commitUpload`,
			body: { uuid, providerCommitData },
		})) as unknown as { body: WebResource };
		return res.body;
	}

	// TODO: be a nice client cancel upload in case it fails
	// TODO: Probably also delete the release asset makes sense

	private async multipartUpload(metadata: FileMetadata) {
		const releaseAssetId = await this.createEmptyReleaseAsset();
		const uploadResponse = await this.beginMultipartUpload(
			releaseAssetId,
			metadata,
		);
		const providerCommitData = await uploadChunks(
			uploadResponse.asset.uploadParts,
			this.inputs,
			metadata,
		);

		const asset = await this.commitMultiPartUpload(
			releaseAssetId,
			uploadResponse.asset.uuid,
			providerCommitData,
		);

		return {
			releaseAssetId,
			relaseAssetUrl: asset.href,
		};
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
