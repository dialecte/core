import type { AnyRelationship, AnyRawRecord } from '@/types'

//====== STATE MANAGEMENT ======//

const pendingChildrenRelationshipsPerParentId: Record<string, AnyRelationship[]> = {}

//====== PUBLIC FUNCTIONS ======//

export function registerPendingChildrenRelationship(params: {
	parentId: string
	child: AnyRelationship
}) {
	const { parentId, child } = params

	if (!pendingChildrenRelationshipsPerParentId[parentId]) {
		pendingChildrenRelationshipsPerParentId[parentId] = []
	}

	const newChildRelationship: AnyRelationship = {
		id: child.id,
		tagName: child.tagName,
	}

	pendingChildrenRelationshipsPerParentId[parentId].push(newChildRelationship)
}

export function resolveCurrentBatchChildrenRelationships(params: {
	currentBatch: AnyRawRecord[]
}): AnyRawRecord[] {
	const { currentBatch } = params
	const updatedCurrentBatch = [...currentBatch]

	for (const [parentIndex, currentParentRecord] of updatedCurrentBatch.entries()) {
		const children = pendingChildrenRelationshipsPerParentId[currentParentRecord.id] || []

		if (children.length > 0) {
			updatedCurrentBatch[parentIndex].children.push(...children)

			removeProcessedChildrenRelationships({
				parentId: currentParentRecord.id,
			})
		}
	}

	return updatedCurrentBatch
}

//====== PRIVATE FUNCTIONS ======//

function removeProcessedChildrenRelationships(params: { parentId: string }): void {
	const { parentId } = params

	delete pendingChildrenRelationshipsPerParentId[parentId]
}
