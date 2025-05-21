import { info } from '@actions/core';
import type { FileMetadata } from './uploadManager.js';
import { sleep } from './uploadManager.js';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import type { ProviderCommitPayload } from './uploader.js';

const MAX_RETRIES = 5; // Maximum number of retries for transient errors
const INITIAL_BACKOFF_MS = 1000; // Initial backoff sleep for retries

export class BalenaAPI {
	private apiHost: string;
	constructor(
		private readonly auth: string,
		readonly balenaHost: string,
	) {
		this.apiHost = `https://api.${balenaHost}`.replace(/\/+$/, '');
	}

	private async fetchWithRetry(
		path: string,
		args: RequestInit,
	): Promise<Response> {
		let attempts = 0;
		let currentBackoff = INITIAL_BACKOFF_MS;

		while (attempts < MAX_RETRIES) {
			attempts++;
			try {
				const url = `${this.apiHost}${path}`;
				const headers: HeadersInit = {
					Authorization: `Bearer ${this.auth}`,
					...args.headers,
				};

				info(`Attempt ${attempts}: Calling ${args.method ?? 'GET'} ${url}`);
				const response = await fetch(url, { ...args, headers });

				if (response.ok) {
					return response;
				}

				if (response.status === 429) {
					const retryAfterHeader = response.headers.get('Retry-After');
					let retryAfterSeconds = currentBackoff / 1000;

					if (retryAfterHeader) {
						const parsedRetryAfter = parseInt(retryAfterHeader, 10);
						if (!isNaN(parsedRetryAfter)) {
							retryAfterSeconds = parsedRetryAfter;
						} else {
							const retryDate = Date.parse(retryAfterHeader);
							if (!isNaN(retryDate)) {
								retryAfterSeconds = Math.max(
									0,
									(retryDate - Date.now()) / 1000,
								);
							}
						}
						info(
							`Received 429. Retrying after ${retryAfterSeconds} seconds (from Retry-After header).`,
						);
					} else {
						info(
							`Received 429. Retrying after ${retryAfterSeconds} seconds (using exponential backoff).`,
						);
					}

					if (attempts >= MAX_RETRIES) {
						info(`Max retries reached for 429 on ${url}.`);
						throw new Error(
							`Too many requests to ${url} after ${attempts} attempts. Last status: ${response.status}`,
						);
					}
					await sleep(retryAfterSeconds * 1000);
					currentBackoff = Math.min(currentBackoff * 2, 30000);
					continue;
				}

				if (response.status >= 500 && response.status <= 599) {
					info(
						`Received server error ${response.status}. Retrying in ${currentBackoff / 1000}s... (Attempt ${attempts}/${MAX_RETRIES})`,
					);
					if (attempts >= MAX_RETRIES) {
						throw new Error(
							`Server error ${response.status} for ${args.method ?? 'GET'} ${url} after ${attempts} attempts. Response: ${await response.text()}`,
						);
					}
					await sleep(currentBackoff + Math.random() * 1000);
					currentBackoff *= 2;
					continue;
				}

				return response;
			} catch (error: any) {
				// Handle network errors (e.g., timeouts, DNS resolution failures)
				info(
					`Network error or fetch exception during attempt ${attempts} for ${args.method ?? 'GET'} ${path}: ${error.message}`,
				);
				if (attempts >= MAX_RETRIES) {
					throw new Error(
						`Failed to fetch ${args.method ?? 'GET'} ${path} after ${attempts} attempts due to network error: ${error.message}`,
					);
				}
				await sleep(currentBackoff + Math.random() * 1000);
				currentBackoff *= 2;
			}
		}

		throw new Error(
			`Failed to complete request to ${path} after ${MAX_RETRIES} attempts.`,
		);
	}

	public async request(path: string, args: RequestInit = {}) {
		return await this.fetchWithRetry(path, {
			...args,
			headers: {
				'Content-Type': 'application/json',
				...args.headers,
			},
		});
	}

	public async baseRequest(path: string, args: RequestInit = {}) {
		return await this.fetchWithRetry(path, args);
	}

	public async whoami() {
		const res = await this.request('/actor/v1/whoami');
		if (res.ok) {
			return await res.json();
		}
		throw new Error('Not logged in');
	}

	public async canAccessRlease(releaseId: number) {
		const res = await this.request(`/resin/release(${releaseId})/canAccess`, {
			method: 'POST',
			body: JSON.stringify({ action: 'update' }),
		});

		if (!res.ok || (await res.json())?.d?.[0]?.id == null) {
			throw new Error('You do not have necessary access to this release');
		}
	}

	public async getReleaseAssetId(
		releaseId: number,
		assetKey: string,
	): Promise<number | undefined> {
		const res = await this.request(
			`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
		);

		const body = await res.json();
		return body.d?.[0]?.id;
	}

	public async createOrGetReleaseAsset(
		releaseId: number,
		assetKey: string,
		overwrite: boolean,
	): Promise<number> {
		const create = await this.request('/resin/release_asset', {
			method: 'POST',
			body: JSON.stringify({
				asset_key: assetKey,
				release: releaseId,
			}),
		});

		if (!create.ok) {
			if (overwrite && create.status === 409) {
				info(`Asset ${assetKey} already exists. Overwriting...`);
				return (await this.getReleaseAssetId(releaseId, assetKey))!;
			} else {
				throw new Error(await create.text());
			}
		}

		return (await create.json()).id;
	}

	public async beginMultipartUpload(
		releaseAssetId: number,
		metadata: FileMetadata,
		chunkSize: number,
	): Promise<{
		asset: {
			uuid: string;
			uploadParts: webresources.UploadPart[];
		};
	}> {
		const res = await this.request(
			`/resin/release_asset(${releaseAssetId})/beginUpload`,
			{
				method: 'POST',
				body: JSON.stringify({
					asset: {
						filename: metadata.filename,
						content_type: metadata.contentType,
						size: metadata.size,
						chunk_size: chunkSize,
					},
				}),
			},
		);

		return await res.json();
	}

	public async commitMultiPartUpload(
		releaseAssetId: number,
		uuid: string,
		providerCommitData: ProviderCommitPayload,
	): Promise<{ href: string }> {
		const res = await this.request(
			`/resin/release_asset(${releaseAssetId})/commitUpload`,
			{
				method: 'POST',
				body: JSON.stringify({ uuid, providerCommitData }),
			},
		);

		return await res.json();
	}

	public async cancelMultiPartUpload(releaseAssetId: number, uuid: string) {
		return await this.request(
			`/resin/release_asset(${releaseAssetId})/cancelUpload`,
			{
				method: 'POST',
				body: JSON.stringify({ uuid }),
			},
		);
	}
}
