import { expect } from 'chai';
import esmock from 'esmock';
import sinon, { type SinonStub } from 'sinon';
import { ZodError } from 'zod';

let getInputStub: SinonStub;
const DEFAULT_VALID_INPUT_STRINGS: Record<string, string> = {
	'balena-token': 'test-token-123',
	'balena-host': 'balena.example.com',
	'release-id': '123456',
	'key-prefix': 'abc',
	path: './path/to/firmware.zip',
	overwrite: 'true',
	'if-no-files-found': 'warn',
	'chunk-size': '104857600',
	'parallel-chunks': '4',
};

const mockGetInputValues = (overrides = {}) => {
	const currentInputs = {
		...DEFAULT_VALID_INPUT_STRINGS,
		...overrides,
	} as Record<string, string>;
	for (const key in currentInputs) {
		if (Object.prototype.hasOwnProperty.call(currentInputs, key)) {
			getInputStub.withArgs(key).returns(currentInputs[key]);
		}
	}
};

describe('getInputs', () => {
	let getInputsFn: () => Promise<any>;

	beforeEach(async () => {
		getInputStub = sinon.stub();
		getInputStub.returns('');

		const { getInputs } = await esmock('../src/input.js', {
			'@actions/core': { getInput: getInputStub },
		});
		getInputsFn = getInputs;
	});

	afterEach(() => {
		getInputStub.reset();
	});

	it('should parse valid inputs correctly', async () => {
		mockGetInputValues();
		const inputs = await getInputsFn();
		expect(inputs).to.deep.equal({
			balenaToken: 'test-token-123',
			balenaHost: 'balena.example.com',
			releaseId: 123456,
			keyPrefix: 'abc',
			path: './path/to/firmware.zip',
			overwrite: true,
			ifFilePathNotFound: 'warn',
			chunkSize: 104857600,
			parallelChunks: 4,
		});
		expect(getInputStub.calledWith('balena-token')).to.be.true;
	});

	it('should correctly parse overwrite to false when input is "false"', async () => {
		mockGetInputValues({ overwrite: 'false' });
		const inputs = await getInputsFn();
		expect(inputs.overwrite).to.be.false;
	});

	it('should correctly parse overwrite to false for any other string value (not "true")', async () => {
		mockGetInputValues({ overwrite: 'any_other_value' });
		const inputs = await getInputsFn();
		expect(inputs.overwrite).to.be.false;
	});

	['balenaToken', 'balenaHost', 'path'].forEach((field) => {
		const inputName = field.replace(/([A-Z])/g, '-$1').toLowerCase();
		it(`should throw ZodError if ${field} is empty string`, async () => {
			mockGetInputValues({ [inputName]: '' });
			try {
				await getInputsFn();
				throw new Error(`${field} validation (empty string) did not throw`);
			} catch (error) {
				expect(error).to.be.instanceOf(ZodError);
				const zodError = error; // No need for 'as ZodError' in JS with instanceof
				expect(zodError.issues[0].path).to.deep.equal([field]);
				expect(zodError.issues[0].message).to.equal(
					'String must contain at least 1 character(s)',
				);
			}
		});

		it(`should throw ZodError if ${field} is whitespace (and trim takes effect)`, async () => {
			mockGetInputValues({ [inputName]: '   ' });
			try {
				await getInputsFn();
				throw new Error(`${field} validation (whitespace) did not throw`);
			} catch (error) {
				expect(error).to.be.instanceOf(ZodError);
				expect(error.issues[0].path).to.deep.equal([field]);
				expect(error.issues[0].message).to.equal(
					'String must contain at least 1 character(s)',
				);
			}
		});
	});

	it('should throw ZodError if releaseId is not a number (e.g., "abc")', async () => {
		mockGetInputValues({ 'release-id': 'not-a-number' });
		try {
			await getInputsFn();
			throw new Error('releaseId (NaN) validation did not throw');
		} catch (error) {
			expect(error).to.be.instanceOf(ZodError);
			expect(error.issues[0].path).to.deep.equal(['releaseId']);
			expect(error.issues[0].message).to.equal('Expected number, received nan');
		}
	});

	it('should throw ZodError if releaseId is an empty string', async () => {
		mockGetInputValues({ 'release-id': '' });
		try {
			await getInputsFn();
			throw new Error('releaseId (empty string) validation did not throw');
		} catch (error) {
			expect(error).to.be.instanceOf(ZodError);
			expect(error.issues[0].path).to.deep.equal(['releaseId']);
			expect(error.issues[0].message).to.equal('Expected number, received nan');
		}
	});

	it('should throw ZodError if chunkSize is less than 5242880', async () => {
		mockGetInputValues({ 'chunk-size': '5242879' });
		try {
			await getInputsFn();
			throw new Error('chunkSize (less than 5242880) validation did not throw');
		} catch (error) {
			expect(error).to.be.instanceOf(ZodError);
			expect(error.issues[0].path).to.deep.equal(['chunkSize']);
			expect(error.issues[0].message).to.equal(
				'Number must be greater than or equal to 5242880',
			);
		}
	});
});
