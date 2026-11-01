/**
 * This realm's private file system refused from now on, as the browser refuses it a sandboxed or storage-blocked
 * frame (the realm's window only: a worker it starts has its own).
 */
export function refuseRealmStorage(): void {
	Object.defineProperty(navigator.storage, 'getDirectory', {
		configurable: true,
		value: async function refusedDirectory() {
			throw new DOMException('The private file system is not allowed here', 'SecurityError')
		},
	})
}

/** The realm's own private file system handed again: the refusal set on the instance removed (`StorageManager` holds the real one). */
export function restoreRealmStorage(): void {
	Reflect.deleteProperty(navigator.storage, 'getDirectory')
}
