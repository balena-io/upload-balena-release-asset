/**
 * Resolves with the error a promise rejected with, or `undefined` if it fulfilled.
 *
 * `chai-as-promised` would need `chai.use()`, which the shared lint config
 * mistakes for a React hook, so assert on the returned error instead.
 */
export const rejectionOf = async (
	promise: Promise<unknown>,
): Promise<Error | undefined> =>
	await promise.then(
		() => undefined,
		(err: Error) => err,
	);
