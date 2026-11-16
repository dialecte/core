import type {
	PendingChildren,
	PendingChildrenOfParse,
	PendingResolution,
} from './pending-children.types'
import type { AnyRawRecord, AnyRelationship } from '@/types'

/**
 * The pending children of one parse, none yet: each parse makes its own, so parses share no state and may run side
 * by side.
 */
export function createPendingChildren(): PendingChildrenOfParse {
	let pending: PendingChildren = new Map()

	function register(params: { parentId: string; child: AnyRelationship }): void {
		pending = registerPendingChild({ pending, ...params })
	}

	function resolve(params: { batch: AnyRawRecord[] }): AnyRawRecord[] {
		const resolution = resolvePendingChildren({ pending, batch: params.batch })
		pending = resolution.pending
		return resolution.batch
	}

	return { register, resolve }
}

/** The pending children with one more child kept for its parent, after the ones kept before. */
function registerPendingChild(params: {
	pending: PendingChildren
	parentId: string
	child: AnyRelationship
}): PendingChildren {
	const { pending, parentId, child } = params
	return new Map(pending).set(parentId, [...(pending.get(parentId) ?? []), child])
}

/**
 * The batch with each of its records completed with the children kept for it, and the children still waiting. The
 * batch is the parser's own: its records gain their children in place, so a record an import hook was handed sees
 * them too.
 */
function resolvePendingChildren(params: {
	pending: PendingChildren
	batch: AnyRawRecord[]
}): PendingResolution {
	const { pending, batch } = params
	if (pending.size === 0) return { pending, batch }
	const waiting = new Map(pending)
	for (const record of batch) {
		const children = waiting.get(record.id)
		if (!children || children.length === 0) continue
		record.children.push(...children)
		waiting.delete(record.id)
	}
	return { pending: waiting, batch }
}
