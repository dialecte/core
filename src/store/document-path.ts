import {
	DOCUMENT_PATH_MAX_BYTES,
	DOCUMENT_PATH_SEGMENT_MAX_BYTES,
	DOCUMENT_PATH_INVISIBLE_CHARACTER,
	DOCUMENT_PATH_SEPARATOR,
} from './document-path.constants'

import { throwDocumentPathInvalid } from '@/store/store-errors'

import type { DocumentPathParts } from './document-path.types'

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

/** The first rule the path breaks, said for the refusal; none when it is a valid path. */
function brokenRuleOf(params: { path: unknown }): string | undefined {
	const { path } = params
	if (typeof path !== 'string') return 'it is not a string'
	if (path.includes('\\')) return 'it holds a backslash, a folder separator on Windows'
	if (DOCUMENT_PATH_INVISIBLE_CHARACTER.test(path)) {
		return 'it holds an invisible format, separator or control character (Unicode Cc, Cf, Zl or Zp)'
	}
	if (!path.isWellFormed()) return 'it is not well-formed UTF-16 (a lone surrogate)'
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
