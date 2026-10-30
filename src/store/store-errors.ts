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

/** A document path refused for breaking a rule: `reason` says which, `meta.path` is the path as given. */
export function throwDocumentPathInvalid(params: { path: unknown; reason: string }): never {
	const { path, reason } = params
	throwDialecteError('DOCUMENT_PATH_INVALID', {
		detail: `The document path ${JSON.stringify(path)} is refused: ${reason}`,
		meta: { path },
	})
}

/**
 * A document given a place another document holds: the same path, or one a folder of the other's. `takenBy` is
 * that other document.
 */
export function throwDocumentPathTaken(params: {
	documentId: string
	path: string
	takenBy: string
}): never {
	const { documentId, path, takenBy } = params
	throwDialecteError('DOCUMENT_PATH_TAKEN', {
		detail: `Document "${documentId}" cannot take the path "${path}": document "${takenBy}" holds that place`,
		meta: { documentId, path, takenBy },
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

/**
 * A destroy refused while another connection - of this realm, or of another tab - has the project open:
 * nothing is removed; it can be destroyed once that connection is closed.
 */
export function throwOpenElsewhere(params: { storeName: string; connections?: number }): never {
	const { storeName, connections } = params
	throwDialecteError('PROJECT_OPEN_ELSEWHERE', {
		detail: `Project "${storeName}" cannot be destroyed while another connection has it open: close that one first`,
		meta: { project: storeName, ...(connections !== undefined && { connections }) },
	})
}

/** An operation through a store closed by `close()`: refused until the store is opened again. */
export function throwStoreClosed(params: { storeName: string }): never {
	const { storeName } = params
	throwDialecteError('STORE_CLOSED', {
		detail: `Store "${storeName}" is closed: open it again before using it`,
		meta: { storeName },
	})
}
