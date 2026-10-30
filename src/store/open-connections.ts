import type { OpenConnections } from './open-connections.types'

/** A count of the open connections of each name, in this realm: a store's destroy is refused while another is open. */
export function createOpenConnections(): OpenConnections {
	const open = new Map<string, Set<object>>()
	return {
		markOpen: function markOpen({ name, connection }) {
			const connections = open.get(name) ?? new Set<object>()
			connections.add(connection)
			open.set(name, connections)
		},
		markClosed: function markClosed({ name, connection }) {
			const connections = open.get(name)
			if (!connections?.delete(connection) || connections.size > 0) return
			open.delete(name)
		},
		others: function countOthers({ name, connection }) {
			const connections = open.get(name)
			if (!connections) return 0
			return connections.size - (connection !== undefined && connections.has(connection) ? 1 : 0)
		},
	}
}
