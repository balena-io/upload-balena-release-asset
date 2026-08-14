import { info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import type { ProviderCommitPayload } from './uploader.js';
import ky, { HTTPError, type KyInstance } from 'ky';
import { retryUntilFound } from './retry.js';

const MAX_RETRIES = 5;
export type OData<T> = {
	d?: T[];
};

type ODataID = OData<{ id?: number }>;

type ODataReleaseAsset = OData<{
	id?: number;
	asset?: { href?: string } | null;
}>;

type ReleaseAssetBeginUpload = {
	asset: {
		uuid: string;
		uploadParts: webresources.UploadPart[];
	};
};

const describeReleaseAsset = (releaseId: number, assetKey: string) =>
	`release asset '${assetKey}' of release ${releaseId}`;

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
		await this.request.post(`v7/release(${releaseId})/canAccess`, {
			json: { action: 'update' },
		});
	}

	public async getReleaseAssetId(releaseId: number, assetKey: string) {
		const res = await this.request.get<ODataID>(
			`v7/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
		);

		const body = await res.json();
		return body.d?.[0]?.id;
	}

	/**
	 * Reads the id of a release asset we know exists, tolerating replication lag.
	 *
	 * A write is acknowledged by a primary, but a read that immediately follows can
	 * be served by a replica that has not caught up, so an asset we just wrote can
	 * briefly read back as if it did not exist.
	 */
	public async getReleaseAssetIdAfterWrite(
		releaseId: number,
		assetKey: string,
	): Promise<number> {
		return await retryUntilFound(
			() => this.getReleaseAssetId(releaseId, assetKey),
			describeReleaseAsset(releaseId, assetKey),
		);
	}

	/**
	 * Reads back the id of a release asset we just uploaded, once it is usable.
	 *
	 * On top of the replication lag handled above, the row can show up before its
	 * asset is populated, so the id is only returned once both are readable. The
	 * href itself is deliberately not returned or logged: it is a presigned URL,
	 * and on an overwrite a lagging replica can still be serving the previous one.
	 */
	public async getUploadedReleaseAssetId(
		releaseId: number,
		assetKey: string,
	): Promise<number> {
		return await retryUntilFound(
			async () => {
				const res = await this.request.get<ODataReleaseAsset>(
					`v7/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id,asset`,
				);

				const { id, asset } = (await res.json()).d?.[0] ?? {};
				return asset?.href != null ? id : undefined;
			},
			describeReleaseAsset(releaseId, assetKey),
		);
	}

	public async createOrGetReleaseAsset(
		releaseId: number,
		assetKey: string,
		overwrite: boolean,
	): Promise<number> {
		try {
			const create = await this.request.post<{ id: number }>(
				'v7/release_asset',
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
				// The 409 proves the asset exists, so an empty read here is lag.
				return await this.getReleaseAssetIdAfterWrite(releaseId, assetKey);
			} else {
				throw new Error(
					`Failed to create ${describeReleaseAsset(releaseId, assetKey)}`,
					{ cause: e },
				);
			}
		}
	}

	public async beginMultipartUpload(
		releaseAssetId: number,
		metadata: FileMetadata,
		chunkSize: number,
	) {
		const res = await this.request.post<ReleaseAssetBeginUpload>(
			`v7/release_asset(${releaseAssetId})/beginUpload`,
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
		await this.request.post(
			`v7/release_asset(${releaseAssetId})/commitUpload`,
			{
				json: { uuid, providerCommitData },
			},
		);
	}

	public async cancelMultiPartUpload(releaseAssetId: number, uuid: string) {
		return await this.request.post(
			`v7/release_asset(${releaseAssetId})/cancelUpload`,
			{
				json: { uuid },
			},
		);
	}
}
