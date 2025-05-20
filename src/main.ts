import { setFailed } from '@actions/core';
import { context } from '@actions/github';
import { getInputs } from './input.js';

export async function run(): Promise<void> {
	try {
		const inputs = await getInputs();
		console.log('The input values are', JSON.stringify(inputs));

		// Get the JSON webhook payload for the event that triggered the workflow
		// TODO: remove me
		const payload = JSON.stringify(context.payload, undefined, 2);
		console.log(`The event payload: ${payload}`);
	} catch (error) {
		setFailed(error.message);
	}
}
