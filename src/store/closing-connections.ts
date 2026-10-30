import type { ClosingConnections } from './closing-connections.types'

/**
 * The connections of each name closed while operations of theirs still run, in this realm: a closed
 * connection counts open no more, and a destroy of the name lets its running operations complete first.
 */
export function createClosingConnections(): ClosingConnections {
	const closing = new Map<string, Set<Promise<void>>>()
	return {
		markClosing: function markClosing({ name, until }) {
			const pending = closing.get(name) ?? new Set<Promise<void>>()
			closing.set(name, pending)
			const settled = until.then(settleNothing, settleNothing)
			pending.add(settled)
			void settled.then(function forgetSettled() {
				pending.delete(settled)
				if (pending.size === 0 && closing.get(name) === pending) closing.delete(name)
			})
		},
		settled: async function untilSettled({ name }) {
			// one closed while the others settled is waited for too
			for (let pending = closing.get(name); pending; pending = closing.get(name)) {
				await Promise.all(pending)
			}
		},
	}
}

function settleNothing(): void {}
