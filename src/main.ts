import { error, info, setFailed, setOutput, warning } from '@actions/core';
import { getInputs } from './input.js';
import { ReleaseAssetUploader } from './uploader.js';
import { fileExists } from './uploadManager.js';
import { getFilesWithKeys } from './search.js';

export async function run(): Promise<void> {
	try {
		const inputs = await getInputs();
		info(
			`Starting upload with ${JSON.stringify(
				{
					balenaHost: inputs.balenaHost,
					releaseId: inputs.releaseId,
					assetKey: inputs.keyPrefix,
					filePath: inputs.path,
					overwrite: inputs.overwrite,
					ifFilePathNotFound: inputs.ifFilePathNotFound,
					chunkSize: inputs.chunkSize,
					parallelChunks: inputs.parallelChunks,
				},
				null,
				2,
			)}`,
		);

		const files = await getFilesWithKeys(inputs.path, inputs.keyPrefix);
		info(`Found ${files.length} files matching the pattern ${inputs.path}`);
		info(`Files found: ${JSON.stringify(files, null, 2)}`);
		if (files.length > 0) {
			const output: Array<{ id: number; url: string; key: string }> = [];
			for (const { filePath, key } of files) {
				info(`Uploading file ${filePath}`);
				await fileExists(filePath, inputs.ifFilePathNotFound);

				const uploader = new ReleaseAssetUploader({
					...inputs,
					filePath,
					assetKey: key,
				});
				const { relaseAssetUrl, releaseAssetId } = await uploader.uploadFile();
				output.push({
					id: releaseAssetId,
					url: relaseAssetUrl,
					key,
				});
			}

			setOutput('release-assets', JSON.stringify(output));
		} else {
			const errMsg = `No files found matching the pattern ${inputs.path}`;
			if (inputs.ifFilePathNotFound === 'error') {
				throw new Error(errMsg);
			} else if (inputs.ifFilePathNotFound === 'warn') {
				warning(errMsg);
			}
		}
	} catch (err) {
		error(err.stack);
		setFailed(err.message);
	}
}
