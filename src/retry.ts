import { debug } from '@actions/core';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 500;

export type RetryOptions = {
	attempts?: number;
	baseDelayMs?: number;
};

/**
 * Polls `read` until it returns a non-nullish value.
 *
 * A write is acknowledged by a primary, but a read that immediately follows may
 * be served by a replica that has not caught up yet, so a resource we just wrote
 * can briefly look like it does not exist. A short backoff rides that lag out.
 *
 * Errors thrown by `read` are not retried: ky already retries 5xx/429 for us, and
 * failing fast on e.g. an auth error is better than hiding it behind a timeout.
 */
export const retryUntilFound = async <T>(
	read: () => Promise<T | undefined>,
	description: string,
	{
		attempts = DEFAULT_ATTEMPTS,
		baseDelayMs = DEFAULT_BASE_DELAY_MS,
	}: RetryOptions = {},
): Promise<T> => {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const result = await read();
		if (result != null) {
			return result;
		}

		if (attempt < attempts) {
			const delay = baseDelayMs * 2 ** (attempt - 1);
			debug(
				`Could not read ${description} (attempt ${attempt}/${attempts}), retrying in ${delay}ms`,
			);
			await sleep(delay);
		}
	}

	throw new Error(
		`Timed out waiting for ${description} to become readable after ${attempts} attempts`,
	);
};
