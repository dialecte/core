import { POOL_ROOT_DIRECTORY } from '../sqlite/runtime/runtime.constants'

/** The projects whose name starts with `prefix` still holding a pool on the origin's private file system. */
export async function leftoverPoolsOf(params: { prefix: string }): Promise<string[]> {
	const root = await navigator.storage.getDirectory()
	const left: string[] = []
	try {
		// a directory per dialecte, one per project in it
		const pools = await root.getDirectoryHandle(POOL_ROOT_DIRECTORY)
		for await (const dialecte of pools.values()) {
			if (dialecte.kind !== 'directory') continue
			for await (const name of (dialecte as FileSystemDirectoryHandle).keys()) {
				if (decodeURIComponent(name).startsWith(params.prefix)) left.push(name)
			}
		}
	} catch {
		// no pool directory at all
	}
	return left
}
