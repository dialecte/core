import { toDialecteError } from './errors'

/** The key a promise rejected with (the error's text when it carries none); `resolved` when it did not reject. */
export async function rejectionKey(params: { action: Promise<unknown> }): Promise<string> {
	try {
		await params.action
		return 'resolved'
	} catch (thrown) {
		return toDialecteError(thrown)?.key ?? String(thrown)
	}
}
