import { expect, use as chaiUse } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import sinon from 'sinon';
import esmock from 'esmock';
import type { BalenaAPI as BalenaAPIType } from '../src/api.js';

chaiUse(chaiAsPromised);

const mockAuth = 'test-auth-token';
const mockBalenaHost = 'dummytest.io';
const expectedApiHost = `https://api.${mockBalenaHost}`;
let BalenaAPI: typeof BalenaAPIType;
let sleepStub: sinon.SinonStub;
let infoSpy: sinon.SinonSpy;

describe('BalenaAPI', () => {
	beforeEach(async () => {
		sleepStub = sinon.stub().resolves();
		infoSpy = sinon.spy();

		const { BalenaAPI: ImportedBalenaAPI } = await esmock('../src/api.js', {
			'../src/uploadManager.js': {
				sleep: sleepStub,
			},
			'@actions/core': {
				info: infoSpy,
			},
		});
		BalenaAPI = ImportedBalenaAPI;

		if (!nock.isActive()) {
			nock.activate();
		}
		nock.disableNetConnect();
	});

	afterEach(() => {
		nock.cleanAll();
		nock.restore();
		sinon.restore();
	});

	describe('constructor', () => {
		it('should correctly initialize apiHost', () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			expect(api['apiHost']).to.equal(expectedApiHost);
		});

		it('should correctly initialize apiHost and remove trailing slashes from balenaHost', () => {
			const api = new BalenaAPI(mockAuth, `${mockBalenaHost}///`);
			expect(api['apiHost']).to.equal(expectedApiHost);
		});
	});

	describe('request', () => {
		it('should call fetchWithRetry and add Content-Type: application/json header by default', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const path = '/test/path';
			const body = { data: 'test' };
			nock(expectedApiHost)
				.post(path, body)
				.matchHeader('Authorization', `Bearer ${mockAuth}`)
				.matchHeader('Content-Type', 'application/json')
				.reply(200, { success: true });

			const response = await api.request(path, {
				method: 'POST',
				body: JSON.stringify(body),
			});
			expect(response.ok).to.be.true;
			const responseBody = await response.json();
			expect(responseBody).to.deep.equal({ success: true });
		});

		it('should allow overriding Content-Type header', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const path = '/test/path';
			const plainBody = 'text data';
			nock(expectedApiHost)
				.post(path, plainBody)
				.matchHeader('Content-Type', 'text/plain')
				.reply(200, { success: true });

			const response = await api.request(path, {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: plainBody,
			});
			expect(response.ok).to.be.true;
		});
	});

	describe('baseRequest', () => {
		it('should call fetchWithRetry without adding Content-Type: application/json by default', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const path = '/base/test';
			nock(expectedApiHost)
				.get(path)
				.matchHeader('Authorization', `Bearer ${mockAuth}`)
				// Nock will by default not care about unspecified headers, but we want to ensure 'Content-Type' isn't added by baseRequest
				.reply(200, (uri, requestBody, cb) => {
					console.log(uri, requestBody);
					expect(
						// @ts-expect-error - as comment above
						nock.pendingMocks()[0]?.keyedInterceptors[
							// @ts-expect-error - as comment above
							Object.keys(nock.pendingMocks()[0]?.keyedInterceptors)[0]
						][0].options.headers['content-type'],
					).to.be.undefined;
					cb(null, { success: true });
				});

			const response = await api.baseRequest(path, { method: 'GET' });
			expect(response.ok).to.be.true;
			const responseBody = await response.json();
			expect(responseBody).to.deep.equal({ success: true });
		});
	});

	describe('whoami', () => {
		it('should return user data on success', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const mockUserData = { id: 1, username: 'testuser' };
			nock(expectedApiHost).get('/actor/v1/whoami').reply(200, mockUserData);

			const user = await api.whoami();
			expect(user).to.deep.equal(mockUserData);
		});

		it('should throw "Not logged in" on non-ok response', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.get('/actor/v1/whoami')
				.reply(401, { error: 'Unauthorized' });

			await expect(api.whoami()).to.be.rejectedWith('Not logged in');
		});
	});

	describe('canAccessRlease', () => {
		const releaseId = 123;

		it('should resolve if access is granted', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release(${releaseId})/canAccess`, { action: 'update' })
				.reply(200, { d: [{ id: 1 }] });

			await expect(api.canAccessRlease(releaseId)).to.be.fulfilled;
		});

		it('should throw if response is not ok', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release(${releaseId})/canAccess`)
				.reply(403, { error: 'Forbidden' });

			await expect(api.canAccessRlease(releaseId)).to.be.rejectedWith(
				'You do not have necessary access to this release',
			);
		});

		it('should throw if response body is missing "d" array or id is null', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release(${releaseId})/canAccess`)
				.reply(200, { data: 'no d property' });
			await expect(api.canAccessRlease(releaseId)).to.be.rejectedWith(
				'You do not have necessary access to this release',
			);

			nock(expectedApiHost)
				.post(`/resin/release(${releaseId})/canAccess`)
				.reply(200, { d: [] });
			await expect(api.canAccessRlease(releaseId)).to.be.rejectedWith(
				'You do not have necessary access to this release',
			);

			nock(expectedApiHost)
				.post(`/resin/release(${releaseId})/canAccess`)
				.reply(200, { d: [{ id: null }] });
			await expect(api.canAccessRlease(releaseId)).to.be.rejectedWith(
				'You do not have necessary access to this release',
			);
		});
	});

	describe('getReleaseAssetId', () => {
		const releaseId = 123;
		const assetKey = 'my-asset.zip';

		it('should return asset id if found', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const assetId = 456;
			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(200, { d: [{ id: assetId }] });

			const result = await api.getReleaseAssetId(releaseId, assetKey);
			expect(result).to.equal(assetId);
		});

		it('should return undefined if asset not found', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(200, { d: [] });

			const result = await api.getReleaseAssetId(releaseId, assetKey);
			expect(result).to.be.undefined;

			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(200, {});

			const result2 = await api.getReleaseAssetId(releaseId, assetKey);
			expect(result2).to.be.undefined;
		});

		it('should throw if API communication fails', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(500, 'Server Error');

			await expect(
				api.getReleaseAssetId(releaseId, assetKey),
			).to.be.rejectedWith('Failed to fetch GET');
		});
	});

	describe('createOrGetReleaseAsset', () => {
		const releaseId = 123;
		const assetKey = 'new-asset.txt';
		const createdAssetId = 789;

		it('should create asset and return its id', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post('/resin/release_asset', {
					asset_key: assetKey,
					release: releaseId,
				})
				.reply(201, { id: createdAssetId });

			const result = await api.createOrGetReleaseAsset(
				releaseId,
				assetKey,
				false,
			);
			expect(result).to.equal(createdAssetId);
		});

		it('should overwrite if asset exists, overwrite is true, and get succeeds', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const existingAssetId = 788;
			nock(expectedApiHost)
				.post('/resin/release_asset', {
					asset_key: assetKey,
					release: releaseId,
				})
				.reply(409, { error: 'Conflict' });
			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(200, { d: [{ id: existingAssetId }] });

			const result = await api.createOrGetReleaseAsset(
				releaseId,
				assetKey,
				true,
			);
			expect(result).to.equal(existingAssetId);
			expect(
				infoSpy.calledWith(`Asset ${assetKey} already exists. Overwriting...`),
			).to.be.true;
		});

		it('should return undefined if overwrite is true, 409 on create, but getReleaseAssetId returns undefined', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post('/resin/release_asset', {
					asset_key: assetKey,
					release: releaseId,
				})
				.reply(409, { error: 'Conflict' });
			nock(expectedApiHost)
				.get(
					`/resin/release_asset(release=${releaseId},asset_key='${assetKey}')?$select=id`,
				)
				.reply(200, { d: [] });

			const result = await api.createOrGetReleaseAsset(
				releaseId,
				assetKey,
				true,
			);
			expect(result).to.be.undefined;
			expect(
				infoSpy.calledWith(`Asset ${assetKey} already exists. Overwriting...`),
			).to.be.true;
		});

		it('should throw if create fails with 409 and overwrite is false', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const conflictErrorText = 'Asset already exists.';
			nock(expectedApiHost)
				.post('/resin/release_asset', {
					asset_key: assetKey,
					release: releaseId,
				})
				.reply(409, conflictErrorText);

			await expect(
				api.createOrGetReleaseAsset(releaseId, assetKey, false),
			).to.be.rejectedWith(conflictErrorText);
		});

		it('should throw if create fails with non-409 status', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			const serverErrorText = 'Internal Server Error.';
			nock(expectedApiHost)
				.post('/resin/release_asset', {
					asset_key: assetKey,
					release: releaseId,
				})
				.reply(500, serverErrorText);

			await expect(
				api.createOrGetReleaseAsset(releaseId, assetKey, true),
			).to.be.rejectedWith('Failed to fetch ');
		});
	});

	describe('beginMultipartUpload', () => {
		const releaseAssetId = 987;
		const metadata = {
			filename: 'large.file',
			contentType: 'application/octet-stream',
			size: 1024 * 1024,
		};
		const chunkSize = 512 * 1024;
		const mockUploadData = {
			asset: {
				uuid: 'test-uuid-123',
				uploadParts: [
					{
						partNumber: 1,
						uploadUrl: 'http://s3.upload.here/1',
						ETag: '123',
					},
				],
			},
		};

		it('should begin upload and return upload data', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/beginUpload`, {
					asset: {
						filename: metadata.filename,
						content_type: metadata.contentType,
						size: metadata.size,
						chunk_size: chunkSize,
					},
				})
				.reply(200, mockUploadData);

			const result = await api.beginMultipartUpload(
				releaseAssetId,
				metadata,
				chunkSize,
			);
			expect(result).to.deep.equal(mockUploadData);
		});

		it('should throw if API call fails', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/beginUpload`)
				.reply(500, 'Server Error');

			await expect(
				api.beginMultipartUpload(releaseAssetId, metadata, chunkSize),
			).to.be.rejectedWith('Failed to fetch POST');
		});
	});

	describe('commitMultiPartUpload', () => {
		const releaseAssetId = 987;
		const uuid = 'test-uuid-123';
		const providerCommitData = { Parts: [{ ETag: 'etag1', PartNumber: 1 }] };
		const mockCommitResponse = {
			href: `/download/release_asset_id=${releaseAssetId}`,
		};

		it('should commit upload and return response', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/commitUpload`, {
					uuid,
					providerCommitData,
				})
				.reply(200, mockCommitResponse);

			const result = await api.commitMultiPartUpload(
				releaseAssetId,
				uuid,
				providerCommitData,
			);
			expect(result).to.deep.equal(mockCommitResponse);
		});

		it('should throw if API call fails', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/commitUpload`)
				.reply(500, 'Server Error');

			await expect(
				api.commitMultiPartUpload(releaseAssetId, uuid, providerCommitData),
			).to.be.rejectedWith('Failed to fetch POST');
		});
	});

	describe('cancelMultipartUpload', () => {
		const releaseAssetId = 987;
		const uuid = 'test-uuid-123';

		it('should commit upload and return response', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/cancelUpload`, {
					uuid,
				})
				.reply(204);

			const result = await api.cancelMultiPartUpload(releaseAssetId, uuid);
			expect(result.status).to.be.eq(204);
		});

		it('should throw if API call fails', async () => {
			const api = new BalenaAPI(mockAuth, mockBalenaHost);
			nock(expectedApiHost)
				.post(`/resin/release_asset(${releaseAssetId})/cancelUpload`)
				.reply(500, 'Server Error');

			await expect(
				api.cancelMultiPartUpload(releaseAssetId, uuid),
			).to.be.rejectedWith('Failed to fetch POST');
		});
	});
});
