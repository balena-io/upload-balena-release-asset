import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import { rejectionOf } from './helpers.js';

describe('retry', () => {
	let debugStub: sinon.SinonStub;
	let retryUntilFound: typeof import('../src/retry.js').retryUntilFound;

	beforeEach(async () => {
		debugStub = sinon.stub();

		({ retryUntilFound } = await esmock('../src/retry.js', {
			'@actions/core': {
				debug: debugStub,
			},
		}));
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should return the first result without retrying when it is found', async () => {
		const read = sinon.stub().resolves({ id: 1 });

		const result = await retryUntilFound(read, 'some resource', {
			baseDelayMs: 1,
		});

		expect(result).to.deep.equal({ id: 1 });
		expect(read.calledOnce).to.be.true;
		expect(debugStub.notCalled).to.be.true;
	});

	it('should retry until the resource becomes readable', async () => {
		const read = sinon.stub();
		read.onFirstCall().resolves(undefined);
		read.onSecondCall().resolves(undefined);
		read.onThirdCall().resolves({ id: 7 });

		const result = await retryUntilFound(read, 'some resource', {
			baseDelayMs: 1,
		});

		expect(result).to.deep.equal({ id: 7 });
		expect(read.callCount).to.equal(3);
		expect(debugStub.callCount).to.equal(2);
		expect(debugStub.firstCall.args[0]).to.include('some resource');
	});

	it('should throw a descriptive error once the attempts run out', async () => {
		const read = sinon.stub().resolves(undefined);

		const err = await rejectionOf(
			retryUntilFound(read, 'some resource', { attempts: 3, baseDelayMs: 1 }),
		);

		expect(err?.message).to.equal(
			'Timed out waiting for some resource to become readable after 3 attempts',
		);
		expect(read.callCount).to.equal(3);
	});

	it('should not retry when the read itself throws', async () => {
		const read = sinon.stub().rejects(new Error('Unauthorized'));

		const err = await rejectionOf(
			retryUntilFound(read, 'some resource', { baseDelayMs: 1 }),
		);

		expect(err?.message).to.equal('Unauthorized');
		expect(read.calledOnce).to.be.true;
	});
});
