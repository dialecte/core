import {
	ALWAYS_READ_EXTENSION,
	DOCUMENT_PATH_MAX_BYTES,
	DOCUMENT_PATH_SEGMENT_MAX_BYTES,
	DOCUMENT_PATH_INVISIBLE_CHARACTER,
	DOCUMENT_PATH_SEPARATOR,
	DOCUMENT_UPDATE_FIELDS,
} from './document-path.constants'
import { NOT_WELL_FORMED_TEXT } from './json-values.constants'

import { throwDocumentPathInvalid, throwDocumentPathTaken } from '@/store/store-errors'

import type { DocumentPathParts, PathHolderCandidate } from './document-path.types'
import type { DocumentRecord, DocumentUpdates } from '@/project/types'

/**
 * A document's path read apart into its folders and its file name. A path is relative and written one way only:
 * segments joined by `/`, none empty, none `.` or `..`, no backslash, no invisible format, separator or control
 * character, well-formed and in Unicode NFC, each segment at most 255 UTF-8 bytes and the whole at most 1024.
 * Nothing is rewritten: a path breaking a rule is refused with `DOCUMENT_PATH_INVALID`, `detail` naming the rule,
 * `meta.path` the path as given.
 */
export function parseDocumentPath(params: { path: string }): DocumentPathParts {
	const { path } = params
	const reason = brokenRuleOf({ path })
	if (reason !== undefined) throwDocumentPathInvalid({ path, reason })
	const segments = path.split(DOCUMENT_PATH_SEPARATOR)
	const fileName = segments.pop()!
	return { folders: segments, fileName }
}

/**
 * The extensions a document's config reads: the ones it lists, in their order, then `ALWAYS_READ_EXTENSION` (`.xml`)
 * unless one of them is exactly it (a listed `.XML` matches no lower-cased file name, so `.xml` is still added). The
 * first one is the extension core gives a document nothing names one for: the first listed, `.xml` for an empty list.
 */
export function readableExtensionsOf(params: { extensions: readonly string[] }): readonly string[] {
	const { extensions } = params
	const listsAlwaysRead = extensions.includes(ALWAYS_READ_EXTENSION)
	return listsAlwaysRead ? extensions : [...extensions, ALWAYS_READ_EXTENSION]
}

/**
 * The name and the extension of a path's file name, split at its last dot: for a document that has no extension
 * yet (an import, a new document). A path breaking a rule, a file name without a name and an extension by that rule
 * (`README`, `north.`, `.scd`), or - when `extensions` are given - one whose extension is not among them (compared as a
 * file's name is: lower-cased), is refused with `DOCUMENT_PATH_INVALID`.
 */
export function splitFileName(params: {
	path: string
	extensions?: readonly string[]
}): Pick<DocumentRecord, 'name' | 'extension'> {
	const { path, extensions } = params
	const { fileName } = parseDocumentPath({ path })
	const dot = fileName.lastIndexOf('.')
	if (dot < 1 || dot === fileName.length - 1) {
		throwDocumentPathInvalid({ path, reason: 'its file name has no extension after a name' })
	}
	if (extensions && !extensions.some((extension) => fileName.toLowerCase().endsWith(extension))) {
		throwDocumentPathInvalid({
			path,
			reason: `its extension is not one the document's config reads (${extensions.join(', ')})`,
		})
	}
	return { name: fileName.slice(0, dot), extension: fileName.slice(dot) }
}

/**
 * Check the path a document is registered with: a valid path ending with the document's file name, its `name` then
 * its own `extension` (`name` non-empty); none passes. Refused with `DOCUMENT_PATH_INVALID`.
 */
export function assertDocumentPath(params: {
	document: Pick<DocumentRecord, 'name' | 'extension' | 'path'>
}): void {
	const { name, extension, path } = params.document
	if (path === undefined) return
	const { fileName } = parseDocumentPath({ path })
	if (typeof name !== 'string' || typeof extension !== 'string') {
		throwDocumentPathInvalid({
			path,
			reason: 'a path names a file of a name and an extension that are strings',
		})
	}
	if (name === '' || fileName !== `${name}${extension}`) {
		throwDocumentPathInvalid({
			path,
			reason: `it does not end with the document's file name ${JSON.stringify(`${name}${extension}`)}`,
		})
	}
}

/**
 * A document with the updates applied, its file name and its path kept one fact: a `path` moves and renames it (its
 * `name` follows the file name, which must end with the document's own `extension`); a `name` on a document with a
 * path rewrites the file name in it, the folders kept; both given must agree; a field given as `undefined` is left
 * as it was, a key beyond `DOCUMENT_UPDATE_FIELDS` ignored. Refused with `DOCUMENT_PATH_INVALID` when the result breaks a rule; the document given is left as it
 * was. Whether the place is free is the store's to check (`assertDocumentPlace`).
 */
export function applyDocumentUpdates(params: {
	document: DocumentRecord
	updates: DocumentUpdates
}): DocumentRecord {
	const { document } = params
	// only the fields an update takes; one given as `undefined` is left as it was
	const updates: DocumentUpdates = Object.fromEntries(
		DOCUMENT_UPDATE_FIELDS.filter((field) => params.updates[field] !== undefined).map((field) => [
			field,
			params.updates[field],
		]),
	)
	const updated: DocumentRecord = { ...document, ...updates }
	if (updates.path !== undefined) {
		const { fileName } = parseDocumentPath({ path: updates.path })
		const { extension } = document
		if (!fileName.endsWith(extension) || fileName.length === extension.length) {
			throwDocumentPathInvalid({
				path: updates.path,
				reason: `it does not end with the document's extension ${JSON.stringify(extension)}`,
			})
		}
		updated.name = updates.name ?? fileName.slice(0, fileName.length - extension.length)
	} else if (updates.name !== undefined && document.path !== undefined) {
		const { folders } = parseDocumentPath({ path: document.path })
		updated.path = [...folders, `${updates.name}${document.extension}`].join(
			DOCUMENT_PATH_SEPARATOR,
		)
	}
	// checked only when it changes: a stored path a later rule refuses never blocks an update of the rest
	if (updates.path !== undefined || updates.name !== undefined)
		assertDocumentPath({ document: updated })
	return updated
}

/**
 * Check a document to register against the registered ones: its path valid and ending with its file name
 * (`DOCUMENT_PATH_INVALID`), then its place free (`DOCUMENT_PATH_TAKEN`). A document without a path passes.
 */
export function assertDocumentPlace(params: {
	document: Pick<DocumentRecord, 'id' | 'name' | 'extension' | 'path'>
	documents: PathHolderCandidate[]
}): void {
	const { document, documents } = params
	assertDocumentPath({ document })
	const { id: documentId, path } = document
	if (path === undefined) return
	const takenBy = pathHolderOf({ path, documents, documentId })
	if (takenBy !== undefined) throwDocumentPathTaken({ documentId, path, takenBy })
}

/**
 * The document whose path clashes with `path`, the document `documentId` excepted: one at that very place, or one
 * whose path is a folder of the other's - a file system holds no file and folder of one name. Paths compare exactly;
 * a document without a path holds no place. None when the place is free.
 */
export function pathHolderOf(params: {
	path: string
	documents: PathHolderCandidate[]
	documentId?: string
}): string | undefined {
	const { path, documents, documentId } = params
	const holder = documents.find(
		(document) =>
			document.id !== documentId &&
			document.path !== undefined &&
			pathsClash({ path, other: document.path }),
	)
	return holder?.id
}

/** Two paths at one place, or one a folder of the other. */
function pathsClash(params: { path: string; other: string }): boolean {
	const { path, other } = params
	return (
		path === other ||
		path.startsWith(`${other}${DOCUMENT_PATH_SEPARATOR}`) ||
		other.startsWith(`${path}${DOCUMENT_PATH_SEPARATOR}`)
	)
}

/** The first rule the path breaks, said for the refusal; none when it is a valid path. */
function brokenRuleOf(params: { path: unknown }): string | undefined {
	const { path } = params
	if (typeof path !== 'string') return 'it is not a string'
	if (path.includes('\\')) return 'it holds a backslash, a folder separator on Windows'
	if (DOCUMENT_PATH_INVISIBLE_CHARACTER.test(path)) {
		return 'it holds an invisible format, separator or control character (Unicode Cc, Cf, Zl or Zp)'
	}
	if (!path.isWellFormed()) return `it is ${NOT_WELL_FORMED_TEXT}`
	if (path.normalize('NFC') !== path) return 'it is not in Unicode NFC'
	const segments = path.split(DOCUMENT_PATH_SEPARATOR)
	if (segments.some((segment) => segment === '')) return 'it holds an empty folder or file name'
	if (segments.some((segment) => segment === '.' || segment === '..')) {
		return 'it holds a folder or file name "." or ".."'
	}
	const encoder = new TextEncoder()
	if (
		segments.some((segment) => encoder.encode(segment).length > DOCUMENT_PATH_SEGMENT_MAX_BYTES)
	) {
		return `it holds a folder or file name of more than ${DOCUMENT_PATH_SEGMENT_MAX_BYTES} bytes (UTF-8)`
	}
	if (encoder.encode(path).length > DOCUMENT_PATH_MAX_BYTES) {
		return `it is more than ${DOCUMENT_PATH_MAX_BYTES} bytes long (UTF-8)`
	}
	return undefined
}
