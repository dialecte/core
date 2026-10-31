import type { DocumentRecord } from '@/project/types'

/**
 * Whether the document held is the one an import registered, still `importing`: the same id, write and
 * creation time. One removed meanwhile and registered again under its id by another connection is not.
 */
export function isOwnImporting(params: {
	held: DocumentRecord | undefined
	registered: DocumentRecord | undefined
}): boolean {
	const { held, registered } = params
	if (!held || !registered || held.status !== 'importing') return false
	return (
		held.id === registered.id &&
		held.writeId === registered.writeId &&
		held.createdAt === registered.createdAt
	)
}
