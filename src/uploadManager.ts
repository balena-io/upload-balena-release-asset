import { info, warning } from '@actions/core';
import type { Inputs } from './input.js';
import fs from 'node:fs/promises';
import path from 'path';
import mime from 'mime-types';
import type { webResourceHandler as webresources } from '@balena/pinejs';
import pLimit from 'p-limit';
import ky from 'ky';

export type FileMetadata = {
	filename: string;
	contentType: string;
	size: number;
};

export const fileExists = async ({
	filePath,
	ifFilePathNotFound,
}: Pick<Inputs, 'filePath' | 'ifFilePathNotFound'>) => {
	try {
		await fs.access(filePath, fs.constants.R_OK);
		return true;
	} catch (error) {
		const errMessage = `File does not exist or is not readable: ${filePath}`;
		if (ifFilePathNotFound === 'error') {
			throw new Error(errMessage, error);
		} else if (ifFilePathNotFound === 'warn') {
			warning(`${errMessage}\n${error.message}`);
		}
		return false;
	}
};

export const fileMetadata = async (filePath: string): Promise<FileMetadata> => {
	const stats = await fs.stat(filePath);
	return {
		filename: path.basename(filePath),
		contentType: mime.lookup(filePath) || 'application/octet-stream',
		size: stats.size,
	};
};

export const loadFile = async (
	filePath: string,
	metadata?: FileMetadata,
): Promise<File> => {
	const buffer = await fs.readFile(filePath);
	return new File([buffer], metadata?.filename ?? path.basename(filePath), {
		type: metadata?.contentType,
	});
};

const getReportProgress = (startTime: number, totalSize: number) => {
	let uploadedBytes = 0;
	return (bytesRead: number) => {
		const elapsed = (Date.now() - startTime) / 1000;
		uploadedBytes += bytesRead;
		const uploadedMB = uploadedBytes / (1024 * 1024);
		const totalMB = totalSize / (1024 * 1024);
		const percent = (uploadedBytes / totalSize) * 100;
		const speed = uploadedBytes / elapsed;
		const eta = (totalSize - uploadedBytes) / speed;

		info(
			`Uploaded ${uploadedMB.toFixed(2)}MB / ${totalMB.toFixed(
				2,
			)}MB (${percent.toFixed(2)}%) - Elapsed: ${elapsed.toFixed(
				1,
			)}s - ETA: ${eta.toFixed(1)}s`,
		);
	};
};

async function uploadPartFromFile(
	fileHandle: fs.FileHandle,
	part: webresources.UploadPart,
	requestedPartSize: number,
	report?: (size: number) => void,
) {
	const buffer = Buffer.alloc(part.chunkSize);
	const offset = (part.partNumber - 1) * requestedPartSize;

	const { bytesRead } = await fileHandle.read(
		buffer,
		0,
		part.chunkSize,
		offset,
	);
	const dataToSend = buffer.subarray(0, bytesRead);

	const res = await ky.put(part.url, {
		body: dataToSend,
		timeout: 120_000,
		retry: {
			limit: 5,
		},
	});

	const receivedEtag = res.headers.get('ETag')?.replace(/^"+|"+$/g, '');
	if (receivedEtag == null || typeof receivedEtag !== 'string') {
		throw new Error(`Error on the received ETag ${receivedEtag}`);
	}
	report?.(bytesRead);

	return { ETag: receivedEtag, PartNumber: part.partNumber };
}

export const uploadChunks = async (
	uploadParts: webresources.UploadPart[],
	inputs: Inputs,
	metadata: FileMetadata,
) => {
	const fileHandle = await fs.open(inputs.filePath, 'r');

	const report = getReportProgress(Date.now(), metadata.size);

	const commitData = {
		Parts: [] as Array<{ PartNumber: number; ETag: string }>,
	};

	const limit = pLimit(inputs.parallelChunks);
	try {
		commitData.Parts = await Promise.all(
			uploadParts.map((part) =>
				limit(() =>
					uploadPartFromFile(fileHandle, part, inputs.chunkSize, report),
				),
			),
		);
	} finally {
		await fileHandle.close();
	}

	return commitData;
};
