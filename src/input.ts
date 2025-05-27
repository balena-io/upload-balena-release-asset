import { getInput } from '@actions/core';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const inputSchema = z.object({
	balenaToken: nonEmptyString,
	balenaHost: nonEmptyString,
	releaseId: z.number().nonnegative(),
	keyPrefix: z.string(),
	path: nonEmptyString,
	overwrite: z.boolean(),
	ifFilePathNotFound: z.enum(['warn', 'error', 'ignore']),
	chunkSize: z.number().min(5242880),
	parallelChunks: z.number().nonnegative(),
});

export type Inputs = z.infer<typeof inputSchema>;

export const getInputs = async () => {
	return await inputSchema.parseAsync({
		balenaToken: getInput('balena-token'),
		balenaHost: getInput('balena-host'),
		releaseId: parseInt(getInput('release-id'), 10),
		keyPrefix: getInput('key-prefix'),
		path: getInput('path'),
		overwrite: getInput('overwrite') === 'true',
		ifFilePathNotFound: getInput('if-no-files-found'),
		chunkSize: parseInt(getInput('chunk-size'), 10),
		parallelChunks: parseInt(getInput('parallel-chunks'), 10),
	});
};
