import { expect } from 'vitest'

import { toDialecteError } from '@/errors'

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
