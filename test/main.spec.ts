import { expect } from 'chai';
import esmock from 'esmock';
import sinon, { type SinonStub } from 'sinon';
import { ZodError, ZodIssueCode } from 'zod';

describe('run', () => {
	let setFailedStub: SinonStub;
	let getInputsStub: SinonStub;
	let consoleLogStub: SinonStub;
	let mockContext: any;
	let runFn: () => Promise<void>;

	const MOCK_VALID_INPUTS = {
		balenaToken: 'test-token-123',
		balenaHost: 'balena.example.com',
		releaseId: 123456,
		assetKey: 'my-firmware-asset',
		filePath: './path/to/firmware.zip',
		overwrite: true,
		ifFilePathNotFound: 'warn',
	};

	beforeEach(async () => {
		setFailedStub = sinon.stub();
		getInputsStub = sinon.stub();
		consoleLogStub = sinon.stub(console, 'log');
		mockContext = {
			payload: {
				action: 'opened',
				issue: { nr: 123 },
			},
		};

		const { run } = await esmock('../src/main.js', {
			'@actions/core': {
				setFailed: setFailedStub,
			},
			'@actions/github': {
				context: mockContext,
			},
			'../src/input.js': {
				getInputs: getInputsStub,
			},
		});
		runFn = run;
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should call getInputs and log inputs and context payload on success', async () => {
		getInputsStub.resolves(MOCK_VALID_INPUTS);

		await runFn();

		expect(getInputsStub.calledOnce).to.be.true;
		expect(
			consoleLogStub.calledWith(
				'The input values are',
				JSON.stringify(MOCK_VALID_INPUTS),
			),
		).to.be.true;
		expect(
			consoleLogStub.calledWith(
				`The event payload: ${JSON.stringify(mockContext.payload, undefined, 2)}`,
			),
		).to.be.true;
		expect(setFailedStub.called).to.be.false;
	});

	it('should call setFailed with the error message if getInputs throws a ZodError', async () => {
		const errorMessage = 'Validation failed';
		const zodError = new ZodError([
			{
				code: ZodIssueCode.invalid_type,
				expected: 'string',
				received: 'undefined',
				path: ['balenaToken'],
				message: errorMessage,
			},
		]);
		getInputsStub.rejects(zodError);

		await runFn();

		expect(getInputsStub.calledOnce).to.be.true;
		expect(setFailedStub.calledOnceWith(zodError.message)).to.be.true;
		expect(consoleLogStub.called).to.be.false;
	});

	it('should call setFailed with the error message if getInputs throws a generic error', async () => {
		const errorMessage = 'Something went wrong';
		const genericError = new Error(errorMessage);
		getInputsStub.rejects(genericError);

		await runFn();

		expect(getInputsStub.calledOnce).to.be.true;
		expect(setFailedStub.calledOnceWith(errorMessage)).to.be.true;
		expect(consoleLogStub.called).to.be.false;
	});
});
