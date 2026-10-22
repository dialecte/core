import { throwDialecteError } from '@/errors'

// The refusals every store answers with, built in one place so each store gives the same key,
// detail and meta.

/** A document id that is already registered. */
export function throwDocumentAlreadyRegistered(params: { documentId: string }): never {
	const { documentId } = params
	throwDialecteError('STORE_DUPLICATE_ID', {
		detail: `Document "${documentId}" is already registered`,
		meta: { documentId },
	})
}

/** A write to a document that is not registered: `what` says what was to be written. */
export function throwDocumentNotRegistered(params: { documentId: string; what: string }): never {
	const { documentId, what } = params
	throwDialecteError('DOCUMENT_NOT_REGISTERED', {
		detail: `Cannot write ${what} to document "${documentId}": it is not registered`,
		meta: { documentId },
	})
}

/** An update of a record the document does not hold. */
export function throwRecordToUpdateNotFound(params: {
	documentId: string
	recordId: string
}): never {
	const { documentId, recordId } = params
	throwDialecteError('STORE_RECORD_NOT_FOUND', {
		detail: `Record "${recordId}" is not in document "${documentId}": nothing to update`,
		meta: { documentId, recordId },
	})
}

/**
 * Creates refused for their ids: `held` the ids the document already holds, `repeated` the ids the
 * write gives more than once. `meta.recordIds` names each refused id once.
 */
export function throwDuplicateRecordIds(params: {
	documentId: string
	held: string[]
	repeated: string[]
	cause?: Error
}): never {
	const { documentId, held, repeated, cause } = params
	const reasons = [
		held.length > 0 ? `already holds: ${unique(held).join(', ')}` : undefined,
		repeated.length > 0 ? `given twice: ${unique(repeated).join(', ')}` : undefined,
	].filter((reason) => reason !== undefined)
	throwDialecteError('STORE_DUPLICATE_ID', {
		detail: `Document "${documentId}" refuses ids to create - ${reasons.join('; ')}`,
		meta: { documentId, recordIds: unique([...held, ...repeated]) },
		cause,
	})
}

function unique(ids: string[]): string[] {
	return [...new Set(ids)]
}
