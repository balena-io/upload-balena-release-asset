import { getInput } from '@actions/core';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const inputSchema = z.object({
	balenaToken: nonEmptyString,
	balenaHost: nonEmptyString,
	releaseId: z.number().nonnegative(),
	assetKey: nonEmptyString,
	filePath: nonEmptyString,
	overwrite: z.boolean(),
	ifFilePathNotFound: z.enum(['warn', 'error', 'ignore']),
});

export const getInputs = async () => {
	return await inputSchema.parseAsync({
		balenaToken: getInput('balena-token'),
		balenaHost: getInput('balena-host'),
		releaseId: parseInt(getInput('release-id'), 10),
		assetKey: getInput('asset-key'),
		filePath: getInput('file-path'),
		overwrite: getInput('overwrite') === 'true',
		ifFilePathNotFound: getInput('if-file-path-not-found'),
	});
};
