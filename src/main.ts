import { info, setFailed, setOutput } from '@actions/core';
import { getInputs } from './input.js';
import { BalenaAPI } from './api.js';
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
			const api = new BalenaAPI(inputs);
			await api.init();
			const { relaseAssetUrl, releaseAssetId } = await api.uploadFile();
			setOutput('asset-id', releaseAssetId);
			setOutput('asset-url', relaseAssetUrl);
		}
	} catch (error) {
		setFailed(error.message);
	}
}
