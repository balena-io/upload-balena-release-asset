import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import type { UploaderParams } from '../src/uploader.js';
import { rejectionOf } from './helpers.js';

const RELEASE_ID = 237228;
const ASSET_KEY = 'compressed/part-6.deflate';
const METADATA = {
	filename: 'part-6.deflate',
	contentType: 'application/octet-stream',
	size: 4115,
};

class FakeHTTPError extends Error {
	constructor(readonly response: { status: number }) {
		super(`Request failed with status code ${response.status}`);
	}
}

const params = (overwrite: boolean): UploaderParams => ({
	balenaToken: 'a-token',
	balenaHost: 'balena-cloud.com',
	releaseId: RELEASE_ID,
	assetKey: ASSET_KEY,
	filePath: './dist/part-6.deflate',
	overwrite,
	ifFilePathNotFound: 'error',
	chunkSize: 5242880,
	parallelChunks: 1,
});

describe('ReleaseAssetUploader', () => {
	let getReleaseAssetId: sinon.SinonStub;
	let getReleaseAssetIdAfterWrite: sinon.SinonStub;
	let getUploadedReleaseAssetId: sinon.SinonStub;
	let post: sinon.SinonStub;
	let patch: sinon.SinonStub;
	let ReleaseAssetUploader: typeof import('../src/uploader.js').ReleaseAssetUploader;

	beforeEach(async () => {
		getReleaseAssetId = sinon.stub();
		getReleaseAssetIdAfterWrite = sinon.stub();
		getUploadedReleaseAssetId = sinon.stub().resolves(5);
		post = sinon.stub().resolves();
		patch = sinon.stub().resolves();

		class FakeBalenaAPI {
			public request = { post, patch };
			public whoami = sinon.stub().resolves({ id: 1 });
			public canAccessRelease = sinon.stub().resolves();
			public getReleaseAssetId = getReleaseAssetId;
			public getReleaseAssetIdAfterWrite = getReleaseAssetIdAfterWrite;
			public getUploadedReleaseAssetId = getUploadedReleaseAssetId;
		}

		({ ReleaseAssetUploader } = await esmock(
			'../src/uploader.js',
			{
				'../src/api.js': { BalenaAPI: FakeBalenaAPI },
				'../src/uploadManager.js': {
					fileMetadata: sinon.stub().resolves(METADATA),
					loadFile: sinon
						.stub()
						.resolves(new File([Buffer.from('deflated')], METADATA.filename)),
					uploadChunks: sinon.stub(),
				},
				// The 409 check is an `instanceof HTTPError`, so the error the test
				// throws has to be an instance of the class the module under test sees.
				ky: { HTTPError: FakeHTTPError },
			},
			{
				'@actions/core': {
					debug: sinon.stub(),
					info: sinon.stub(),
					error: sinon.stub(),
				},
			},
		));
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should create the asset and read its id back through the retrying lookup', async () => {
		getReleaseAssetId.resolves(undefined);

		const releaseAssetId = await new ReleaseAssetUploader(
			params(false),
		).uploadFile();

		expect(releaseAssetId).to.equal(5);
		expect(post.calledOnce).to.be.true;
		expect(patch.notCalled).to.be.true;
		expect(getUploadedReleaseAssetId.calledOnceWith(RELEASE_ID, ASSET_KEY)).to
			.be.true;

		const form = post.firstCall.args[1].body as FormData;
		expect(form.get('asset_key')).to.equal(ASSET_KEY);
		expect(form.get('release')).to.equal(`${RELEASE_ID}`);
	});

	it('should patch an asset that the existence check already found', async () => {
		getReleaseAssetId.resolves(11);

		const releaseAssetId = await new ReleaseAssetUploader(
			params(true),
		).uploadFile();

		expect(releaseAssetId).to.equal(5);
		expect(patch.calledOnce).to.be.true;
		expect(patch.firstCall.args[0]).to.equal(`v7/release_asset(11)`);
		expect(post.notCalled).to.be.true;
		// The upload is only reported once the asset is readable again.
		expect(getUploadedReleaseAssetId.calledOnceWith(RELEASE_ID, ASSET_KEY)).to
			.be.true;
	});

	it('should patch the existing asset when the create conflicts and overwrite is set', async () => {
		// The existence check read a replica that had not caught up, so the create
		// below conflicts with an asset we could not see.
		getReleaseAssetId.resolves(undefined);
		getReleaseAssetIdAfterWrite.resolves(11);
		post.rejects(new FakeHTTPError({ status: 409 }));

		const releaseAssetId = await new ReleaseAssetUploader(
			params(true),
		).uploadFile();

		expect(releaseAssetId).to.equal(5);
		expect(patch.calledOnce).to.be.true;
		expect(patch.firstCall.args[0]).to.equal(`v7/release_asset(11)`);

		// The patch must not try to rewrite the natural key.
		const form = patch.firstCall.args[1].body as FormData;
		expect(form.get('asset_key')).to.be.null;
		expect(form.get('release')).to.be.null;
	});

	it('should report that the asset already exists when the create conflicts without overwrite', async () => {
		getReleaseAssetId.resolves(undefined);
		post.rejects(new FakeHTTPError({ status: 409 }));

		const err = await rejectionOf(
			new ReleaseAssetUploader(params(false)).uploadFile(),
		);

		expect(err?.message).to.equal(
			`A release asset for ${RELEASE_ID} - ${ASSET_KEY} already exists`,
		);
		expect(patch.notCalled).to.be.true;
	});

	it('should propagate a create failure that is not a conflict', async () => {
		getReleaseAssetId.resolves(undefined);
		post.rejects(new FakeHTTPError({ status: 401 }));

		const err = await rejectionOf(
			new ReleaseAssetUploader(params(true)).uploadFile(),
		);

		expect(err?.message).to.equal('Request failed with status code 401');
		expect(patch.notCalled).to.be.true;
		expect(getUploadedReleaseAssetId.notCalled).to.be.true;
	});
});
