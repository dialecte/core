import { findInMemoryState } from './in-memory-state'
import { InMemoryStore } from './in-memory-store'

import { describe, it, expect, beforeEach } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { DocumentRecord } from '@/project/types'
import type { AnyDialecteConfig, AnyRawRecord, BlobRecord } from '@/types'

// What any store must do is in src/store/contract; here is what is InMemoryStore's own.

function makeDocument(id = 'doc-1'): DocumentRecord {
	return {
		id,
		name: 'test-doc',
		extension: '.scd',
		configKey: 'scl',
		createdAt: Date.now(),
		status: 'ready',
	}
}

function makeRecord(id: string, tagName = 'LNode'): AnyRawRecord {
	return {
		id,
		tagName,
		namespace: { prefix: '', uri: '' },
		attributes: [{ name: 'inst', value: '1' }],
		value: '',
		parent: { id: 'root', tagName: 'SCL' },
		children: [],
	}
}

function makeBlobEntry(): BlobRecord {
	return {
		id: 'b1',
		documentId: 'doc-1',
		name: 'file.bin',
		mimeType: undefined,
		size: undefined,
		createdAt: 0,
		attachedTo: [],
	}
}

describe('InMemoryStore (writable)', () => {
	it('getDatabaseInstance returns null: there is no database behind it', () => {
		const store = new InMemoryStore('test', { writable: true })
		expect(store.getDatabaseInstance()).toBeNull()
	})
})

describe('InMemoryStore (non-writable)', () => {
	let store: InMemoryStore

	beforeEach(() => {
		store = new InMemoryStore('test-readonly', { writable: false })
	})

	it('reads return empty', async () => {
		expect(await store.getDocuments()).toEqual([])
		expect(await store.getByDocumentId('any')).toEqual([])
		expect(await store.get('any', 'any')).toBeUndefined()
		expect(await store.getByTagNameInDocument('X', 'any')).toEqual([])
		expect(await store.getChangeLog('any')).toEqual([])
	})

	const writeMethods = [
		['registerDocument', () => store.registerDocument(makeDocument())],
		['updateDocument', () => store.updateDocument('x', { name: 'y' })],
		['removeDocument', () => store.removeDocument('x')],
		['bulkWrite', () => store.bulkWrite('x', { creates: [makeRecord('r1')] })],
		[
			'commit',
			() =>
				store.commit({
					documentId: 'x',
					creates: [makeRecord('r1')],
					updates: [],
					deletes: [],
					onProgress: () => {},
				}),
		],
		['undo', () => store.undo('x')],
		['redo', () => store.redo('x')],
		['addBlob', () => store.addBlob(makeBlobEntry(), new Blob(['x']))],
		['attachBlob', () => store.attachBlob('b1', { documentId: 'd', recordRef: 'r' })],
		['detachBlob', () => store.detachBlob('b1', { documentId: 'd', recordRef: 'r' })],
		['removeBlob', () => store.removeBlob('b1')],
		['importFile', () => store.importFile({ file: new File(['<Root/>'], 'x.xml') })],
	] as const

	it.each(writeMethods)('%s throws STORE_NOT_WRITABLE', async (_name, fn) => {
		await expect(fn()).rejects.toThrow(/read-only/i)
	})
})

describe('InMemoryStore - opened again while it imports', () => {
	it('an import running on the instance, opened again → the open waits for it; the import is kept and applied', async () => {
		let release: () => void = () => {}
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		let sessionReached: () => void = () => {}
		const reached = new Promise<void>((resolve) => {
			sessionReached = resolve
		})
		const store = new InMemoryStore('reopened-while-importing', {
			importRuntime: {
				configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
				defaultConfigKey: 'default',
				hooks: {
					createImportSession: () => ({
						afterImport: async () => {
							sessionReached()
							await gate
							return {}
						},
					}),
				},
			},
		})
		await store.open()
		const namespace = TEST_DIALECTE_CONFIG.namespaces.default.uri
		const importing = store.importFile({
			file: new File([`<Root xmlns="${namespace}"><A/></Root>`], 'one.xml'),
			writeId: 'w-running',
		})
		await reached

		const opening = store.open()
		release()

		await importing
		await opening
		expect(await store.getWriteOutcome({ writeId: 'w-running' })).toBe('applied')
		await store.destroy()
	})
})

describe('InMemoryStore - the state of its name', () => {
	it('a store destroyed → its name holds no state', async () => {
		const name = `state-${crypto.randomUUID()}`
		const store = new InMemoryStore(name)
		await store.registerDocument(makeDocument())

		await store.destroy()

		expect(findInMemoryState({ name })).toBeUndefined()
	})

	it('a placeholder of a name holding data → reads empty, its destroy leaves the data', async () => {
		const name = `state-${crypto.randomUUID()}`
		const store = new InMemoryStore(name)
		await store.registerDocument(makeDocument())
		await store.bulkWrite('doc-1', { creates: [makeRecord('r1')] })
		const placeholder = new InMemoryStore(name, { writable: false })
		await placeholder.open()

		expect(await placeholder.getDocuments()).toEqual([])
		expect(await placeholder.get('r1', 'doc-1')).toBeUndefined()
		await placeholder.destroy()
		expect(await store.get('r1', 'doc-1')).toEqual(makeRecord('r1'))

		await store.destroy()
	})
})
