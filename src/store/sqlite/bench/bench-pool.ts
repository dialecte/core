import type { SyncAccessFileHandle } from './bench.types'
import type { SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** One pool per run: its own directory, removed by `destroy`. */
export async function installPool(params: {
	sqlite3: Sqlite3Static
	project: string
}): Promise<SAHPoolUtil> {
	const { sqlite3, project } = params
	await waitForFreePool({ project })
	return sqlite3.installOpfsSAHPoolVfs({ name: `bench-${project}`, directory: `bench/${project}` })
}

/**
 * A killed worker's sync handles close a little after it is gone; a failed install would remove the
 * pool directory, so every pool file is probed free before the install.
 */
async function waitForFreePool(params: { project: string }): Promise<void> {
	const deadline = performance.now() + 10_000
	for (;;) {
		const busy = await isPoolBusy({ project: params.project })
		if (!busy) return
		if (performance.now() > deadline) throw new Error(`pool of ${params.project} still busy`)
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

async function isPoolBusy(params: { project: string }): Promise<boolean> {
	const opaque = await findDirectory({ path: ['bench', params.project, '.opaque'] })
	if (!opaque) return false
	for await (const handle of opaque.values()) {
		if (handle.kind !== 'file') continue
		try {
			const access = await (handle as SyncAccessFileHandle).createSyncAccessHandle()
			access.close()
		} catch {
			return true
		}
	}
	return false
}

export async function findDirectory(params: {
	path: string[]
}): Promise<FileSystemDirectoryHandle | undefined> {
	let directory = await navigator.storage.getDirectory()
	for (const name of params.path) {
		try {
			directory = await directory.getDirectoryHandle(name)
		} catch {
			return undefined
		}
	}
	return directory
}

export async function directoryBytes(params: {
	directory: FileSystemDirectoryHandle
}): Promise<number> {
	let bytes = 0
	for await (const handle of params.directory.values()) {
		if (handle.kind === 'file') bytes += (await (handle as FileSystemFileHandle).getFile()).size
		else bytes += await directoryBytes({ directory: handle as FileSystemDirectoryHandle })
	}
	return bytes
}
