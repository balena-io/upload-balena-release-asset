import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

describe('uploadManager', () => {
	let accessStub: sinon.SinonStub;
	let warningStub: sinon.SinonStub;
	let fileExistsFn: typeof import('../src/uploadManager.js').fileExists;

	beforeEach(async () => {
		accessStub = sinon.stub();
		warningStub = sinon.stub();

		const mocks = {
			'node:fs/promises': {
				access: accessStub,
				constants: { R_OK: 4 },
			},
			'@actions/core': {
				warning: warningStub,
			},
		};

		const { fileExists } = await esmock('../src/uploadManager.js', mocks);
		fileExistsFn = fileExists;
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should not throw or warn when file is accessible', async () => {
		accessStub.resolves();

		const exists = await fileExistsFn({
			filePath: './some/file.txt',
			ifFilePathNotFound: 'warn',
		});

		expect(exists).to.be.true;
		expect(accessStub.calledOnce).to.be.true;
		expect(warningStub.notCalled).to.be.true;
	});

	it('should throw an error if file is not found and strategy is "error"', async () => {
		const fakeError = new Error('ENOENT');
		accessStub.rejects(fakeError);

		try {
			await fileExistsFn({
				filePath: './missing/file.txt',
				ifFilePathNotFound: 'error',
			});
			throw new Error('Expected fileExists to throw');
		} catch (err) {
			expect(err).to.be.instanceOf(Error);
			expect(err.message).to.include('File does not exist or is not readable');
			expect(err.message).to.include('./missing/file.txt');
		}

		expect(warningStub.notCalled).to.be.true;
	});

	it('should call warning if file is not found and strategy is "warn"', async () => {
		const fakeError = new Error('EACCES');
		accessStub.rejects(fakeError);

		const exists = await fileExistsFn({
			filePath: './unreadable/file.txt',
			ifFilePathNotFound: 'warn',
		});

		expect(exists).to.be.false;
		expect(warningStub.calledOnce).to.be.true;
		const warningMessage = warningStub.firstCall.args[0];
		expect(warningMessage).to.include('File does not exist or is not readable');
		expect(warningMessage).to.include('./unreadable/file.txt');
		expect(warningMessage).to.include('EACCES');
	});
});
