import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import ky from 'ky';
import { rejectionOf } from './helpers.js';

const RELEASE_ID = 237228;
const ASSET_KEY = 'compressed/part-6.deflate';
const ASSET_HREF = 'https://s3.example.com/compressed/part-6.deflate?signature';

const jsonResponse = <T>(body: T) => ({ json: () => Promise.resolve(body) });
// A read served by a replica that has not caught up with the write yet.
const notReplicatedYet = jsonResponse({ d: [] });
const uploadedAsset = jsonResponse({
	d: [{ id: 5, asset: { href: ASSET_HREF } }],
});

class FakeHTTPError extends Error {
	constructor(readonly response: { status: number }) {
		super(`Request failed with status code ${response.status}`);
	}
}

describe('BalenaAPI', () => {
	let getStub: sinon.SinonStub;
	let postStub: sinon.SinonStub;
	let sleepStub: sinon.SinonStub;
	let logStubs: Record<'debug' | 'info', sinon.SinonStub>;
	let api: import('../src/api.js').BalenaAPI;

	beforeEach(async () => {
		getStub = sinon.stub();
		postStub = sinon.stub();
		sleepStub = sinon.stub().resolves();
		logStubs = { debug: sinon.stub(), info: sinon.stub() };

		const { BalenaAPI } = await esmock(
			'../src/api.js',
			// The 409 check is an `instanceof HTTPError`, so the error the test
			// throws has to be an instance of the class the module under test sees.
			{ ky: { default: ky, HTTPError: FakeHTTPError } },
			{
				// Keeps the real backoff logic while taking the delays out of the
				// wall clock.
				'node:timers/promises': { setTimeout: sleepStub },
				'@actions/core': logStubs,
			},
		);

		api = new BalenaAPI('a-token', 'balena-cloud.com');
		api.request = {
			get: getStub,
			post: postStub,
		} as unknown as typeof api.request;
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('getReleaseAssetIdAfterWrite', () => {
		it('should retry the read back until the asset becomes visible', async () => {
			getStub.onFirstCall().resolves(notReplicatedYet);
			getStub.onSecondCall().resolves(jsonResponse({ d: [{ id: 5 }] }));

			const releaseAssetId = await api.getReleaseAssetIdAfterWrite(
				RELEASE_ID,
				ASSET_KEY,
			);

			expect(releaseAssetId).to.equal(5);
			expect(getStub.callCount).to.equal(2);
			expect(sleepStub.calledOnce).to.be.true;
		});

		it('should fail with a descriptive error when the asset never becomes readable', async () => {
			getStub.resolves(notReplicatedYet);

			const err = await rejectionOf(
				api.getReleaseAssetIdAfterWrite(RELEASE_ID, ASSET_KEY),
			);

			expect(err?.message).to.include(
				`Timed out waiting for release asset '${ASSET_KEY}' of release ${RELEASE_ID} to become readable`,
			);
			expect(getStub.callCount).to.equal(5);
		});
	});

	describe('getUploadedReleaseAssetId', () => {
		it('should return the id once the row and its asset are readable', async () => {
			getStub.onFirstCall().resolves(notReplicatedYet);
			getStub.onSecondCall().resolves(uploadedAsset);

			const releaseAssetId = await api.getUploadedReleaseAssetId(
				RELEASE_ID,
				ASSET_KEY,
			);

			expect(releaseAssetId).to.equal(5);
			expect(getStub.callCount).to.equal(2);
		});

		it('should keep polling while the row is visible but its asset is not', async () => {
			getStub.onFirstCall().resolves(jsonResponse({ d: [{ id: 5 }] }));
			getStub
				.onSecondCall()
				.resolves(jsonResponse({ d: [{ id: 5, asset: null }] }));
			getStub.onThirdCall().resolves(uploadedAsset);

			const releaseAssetId = await api.getUploadedReleaseAssetId(
				RELEASE_ID,
				ASSET_KEY,
			);

			expect(releaseAssetId).to.equal(5);
			expect(getStub.callCount).to.equal(3);
		});

		it('should never log the presigned href', async () => {
			getStub.onFirstCall().resolves(notReplicatedYet);
			getStub.onSecondCall().resolves(uploadedAsset);

			await api.getUploadedReleaseAssetId(RELEASE_ID, ASSET_KEY);

			const logged = [...logStubs.debug.args, ...logStubs.info.args]
				.flat()
				.join('\n');
			expect(logged).to.not.include('s3.example.com');
			expect(logged).to.not.include('signature');
		});
	});

	describe('createOrGetReleaseAsset', () => {
		it('should retry looking up the id after a 409 conflict', async () => {
			postStub.rejects(new FakeHTTPError({ status: 409 }));
			getStub.onFirstCall().resolves(notReplicatedYet);
			getStub.onSecondCall().resolves(jsonResponse({ d: [{ id: 9 }] }));

			const releaseAssetId = await api.createOrGetReleaseAsset(
				RELEASE_ID,
				ASSET_KEY,
				true,
			);

			expect(releaseAssetId).to.equal(9);
			expect(getStub.callCount).to.equal(2);
		});

		it('should keep the original error as the cause when the create fails', async () => {
			const cause = new FakeHTTPError({ status: 401 });
			postStub.rejects(cause);

			const err = await rejectionOf(
				api.createOrGetReleaseAsset(RELEASE_ID, ASSET_KEY, true),
			);

			expect(err?.message).to.include(
				`Failed to create release asset '${ASSET_KEY}' of release ${RELEASE_ID}`,
			);
			expect(err?.cause).to.equal(cause);
			expect(getStub.notCalled).to.be.true;
		});
	});
});
