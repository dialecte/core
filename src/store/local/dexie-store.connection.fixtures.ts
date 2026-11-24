import Dexie from 'dexie'

import type { DexieStore } from './dexie-store'
import type { HeldOpen } from './dexie-store.connection.types'

/**
 * The next open of the database by a connection other than the one the store holds now (a reload's registry read, a
 * schema reopen's new connection) held until released: `reached` once it is.
 */
export function holdNextOpen(params: { store: DexieStore }): HeldOpen {
	const { store } = params
	const reached = Promise.withResolvers<void>()
	const released = Promise.withResolvers<void>()
	const original = Dexie.prototype.open
	const current = store.getDatabaseInstance()
	let held = false
	Dexie.prototype.open = function openHeld(this: Dexie) {
		if (held || this.name !== store.name || this === current) return original.call(this)
		held = true
		reached.resolve()
		// the held connection's own open, run once released
		return released.promise.then(original.bind(this))
	} as typeof Dexie.prototype.open
	return {
		reached: reached.promise,
		release: function release() {
			released.resolve()
		},
		restore: function restore() {
			Dexie.prototype.open = original
		},
	}
}
