import { expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { Store } from '../store.types'
import type { DialecteErrorKey } from '@/errors'
import type { DocumentRecord } from '@/project/types'
import type { AnyRawRecord, AnyRelationship, BlobRecord } from '@/types'

export function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		id: 'doc-1',
		name: 'test-doc',
		extension: '.xml',
		configKey: 'test',
		createdAt: 0,
		status: 'ready',
		...overrides,
	}
}

/** A record of tag `A` with one attribute; every field but `id` may be overridden. */
export function makeRecord(params: Pick<AnyRawRecord, 'id'> & Partial<AnyRawRecord>): AnyRawRecord {
	const { id, ...overrides } = params
	return {
		id,
		tagName: 'A',
		namespace: { prefix: '', uri: '' },
		attributes: [{ name: 'a', value: '1' }],
		value: '',
		parent: null,
		children: [],
		...overrides,
	}
}

export function makeBlobEntry(overrides: Partial<BlobRecord> = {}): BlobRecord {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		documentId: overrides.documentId ?? 'doc-1',
		name: overrides.name ?? 'file.bin',
		mimeType: overrides.mimeType,
		size: overrides.size,
		createdAt: overrides.createdAt ?? 0,
		attachedTo: overrides.attachedTo ?? [],
	}
}

/** A parent or child relationship to a record of tag `A`, the tag every fixture record has. */
export function childRef(id: string): AnyRelationship {
	return { id, tagName: 'A' }
}

/** A commit of creates, updates and deletes on one document, progress ignored. */
export function commit(params: {
	store: Store
	documentId: string
	creates?: AnyRawRecord[]
	updates?: AnyRawRecord[]
	deletes?: string[]
}): Promise<void> {
	const { store, documentId, creates = [], updates = [], deletes = [] } = params
	return store.commit({ documentId, creates, updates, deletes, onProgress: () => {} })
}

/** The action rejects with the structured error of that key, and that `meta` and `detail` when given. */
export async function expectRejectsWith(params: {
	action: Promise<unknown>
	key: DialecteErrorKey
	meta?: Record<string, unknown>
	detail?: RegExp
}): Promise<void> {
	const { action, key, meta, detail } = params
	const thrown = await action.then(
		() => undefined,
		(error: unknown) => error,
	)
	expect(thrown, `expected a rejection with ${key}`).toBeDefined()
	const error = toDialecteError(thrown)
	expect(error?.key, `expected ${key}`).toBe(key)
	if (meta) expect(error?.meta, `meta of ${key}`).toEqual(meta)
	if (detail) expect(error?.detail, `detail of ${key}`).toMatch(detail)
}

/** An XML file of core's test dialecte: `body` inside its root. `truncated` cuts the root's close. */
export function contractFile(params: { body: string; name?: string; truncated?: boolean }): File {
	const { body, name = 'contract.xml', truncated = false } = params
	const namespace = TEST_DIALECTE_CONFIG.namespaces.default.uri
	const xml = `<Root xmlns="${namespace}">${body}${truncated ? '' : '</Root>'}`
	return new File([xml], name, { type: 'text/xml' })
}

/** `count` records of the contract session's tag, `B0`.. as their `aB`. */
export function sessionRecords(count: number): string {
	return Array.from({ length: count }, (_, index) => `<B aB="B${index}"/>`).join('')
}

/** Chunks and batches small enough that a file of a few records is stored in several batches. */
export const SMALL_BATCHES = { chunkSize: 16, batchSize: 1 } as const

/**
 * Change everything the caller holds of a value in place: every plain object gets a field it did not
 * have, every array an element. A store that shares its objects with the caller then shows it.
 */
export function scribble(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) scribble(item)
		value.push('scribbled')
		return
	}
	if (
		value === null ||
		typeof value !== 'object' ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return
	}
	for (const field of Object.values(value)) scribble(field)
	Object.assign(value, { scribbled: true })
}
