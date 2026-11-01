import { throwDialecteError } from '@/errors'

/**
 * Whether this realm can run an engine: a worker, and an origin private file system the browser hands it (a private
 * Firefox window, a sandboxed or storage-blocked frame answer `getDirectory` with a refusal).
 */
export async function storesHere(): Promise<boolean> {
	return typeof Worker !== 'undefined' && (await opensFileSystem())
}

/** `STORE_UNAVAILABLE` for `name`: the realm can run no engine (no worker, or no private file system). */
export function refuseWithoutStorage(params: { name: string }): never {
	const hasWorker = typeof Worker !== 'undefined'
	throwDialecteError('STORE_UNAVAILABLE', {
		detail: `Project "${params.name}" cannot be stored with SQLite here: this ${hasWorker ? 'browser gives no private file system' : 'environment has no worker'}`,
		meta: { project: params.name },
	})
}

/** Whether the browser hands this realm its origin private file system. */
async function opensFileSystem(): Promise<boolean> {
	const storage = globalThis.navigator?.storage
	if (typeof storage?.getDirectory !== 'function') return false
	try {
		await storage.getDirectory()
		return true
	} catch {
		return false
	}
}
