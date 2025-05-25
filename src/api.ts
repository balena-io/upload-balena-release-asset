import { info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import type { ProviderCommitPayload } from './uploader.js';
import ky, { HTTPError, type KyInstance } from 'ky';

const MAX_RETRIES = 5;
export type OData<T> = {
	d?: T[];
};

type ODataID = OData<{ id?: number }>;

type ReleaseAssetBeginUpload = {
	asset: {
		uuid: string;
		uploadParts: webresources.UploadPart[];
	};
};

export class BalenaAPI {
	public request: KyInstance;
	constructor(
		private readonly auth: string,
		readonly balenaHost: string,
	) {
		this.request = ky.create({
			prefixUrl: `https://api.${balenaHost}`,
			headers: {
				Authorization: `Bearer ${this.auth}`,
			},
			timeout: 60_000,
			retry: {
				limit: MAX_RETRIES,
				methods: ['get', 'post', 'put', 'delete', 'patch'],
				statusCodes: [429, 500, 502, 503, 504],
				afterStatusCodes: [429],
				delay: (attemptCount) => 0.5 * 2 ** (attemptCount - 1) * 1000,
			},
		});
	}

	public async whoami() {
		const res = await this.request.get('actor/v1/whoami');
		return await res.json();
	}

	public async canAccessRelease(releaseId: number) {
		await this.request.post(`resin/release(${releaseId})/canAccess`, {
			json: { action: 'update' },
		});
	}

	public async getReleaseAssetId(releaseId: number, assetKey: string) {
		const res = await this.request.get<ODataID>(
			`resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
		);

		const body = await res.json();
		return body.d?.[0]?.id;
	}

	public async createOrGetReleaseAsset(
		releaseId: number,
		assetKey: string,
		overwrite: boolean,
	): Promise<number> {
		try {
			const create = await this.request.post<{ id: number }>(
				'resin/release_asset',
				{
					json: {
						asset_key: assetKey,
						release: releaseId,
					},
				},
			);

			return (await create.json()).id;
		} catch (e) {
			if (e instanceof HTTPError && overwrite && e.response.status === 409) {
				info(`Asset ${assetKey} already exists. Overwriting...`);
				return (await this.getReleaseAssetId(releaseId, assetKey))!;
			} else {
				throw new Error('Conflict creating release asset', e.message);
			}
		}
	}

	public async beginMultipartUpload(
		releaseAssetId: number,
		metadata: FileMetadata,
		chunkSize: number,
	) {
		const res = await this.request.post<ReleaseAssetBeginUpload>(
			`resin/release_asset(${releaseAssetId})/beginUpload`,
			{
				json: {
					asset: {
						filename: metadata.filename,
						content_type: metadata.contentType,
						size: metadata.size,
						chunk_size: chunkSize,
					},
				},
			},
		);

		return await res.json();
	}

	public async commitMultiPartUpload(
		releaseAssetId: number,
		uuid: string,
		providerCommitData: ProviderCommitPayload,
	) {
		const res = await this.request.post<{ href: string }>(
			`resin/release_asset(${releaseAssetId})/commitUpload`,
			{
				json: { uuid, providerCommitData },
			},
		);

		return await res.json();
	}

	public async cancelMultiPartUpload(releaseAssetId: number, uuid: string) {
		return await this.request.post(
			`resin/release_asset(${releaseAssetId})/cancelUpload`,
			{
				json: { uuid },
			},
		);
	}
}
