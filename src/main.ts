import { error, info, setFailed, setOutput } from '@actions/core';
import { getInputs } from './input.js';
import { ReleaseAssetUploader } from './uploader.js';
import { fileExists } from './uploadManager.js';

export async function run(): Promise<void> {
	try {
		const inputs = await getInputs();
		info(
			`Starting upload with ${JSON.stringify(
				{
					balenaHost: inputs.balenaHost,
					releaseId: inputs.releaseId,
					assetKey: inputs.assetKey,
					filePath: inputs.filePath,
					overwrite: inputs.overwrite,
					ifFilePathNotFound: inputs.ifFilePathNotFound,
					chunkSize: inputs.chunkSize,
					parallelChunks: inputs.parallelChunks,
				},
				null,
				2,
			)}`,
		);

		const exists = await fileExists(inputs);
		if (exists) {
			const uploader = new ReleaseAssetUploader(inputs);
			const { relaseAssetUrl, releaseAssetId } = await uploader.uploadFile();
			setOutput('asset-id', releaseAssetId);
			setOutput('asset-url', relaseAssetUrl);
		}
	} catch (err) {
		error(err.stack);
		setFailed(err.message);
	}
}
