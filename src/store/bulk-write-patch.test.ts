import { InMemoryStore } from './in-memory'
import { DexieStore } from './local'

import { describe, expect, afterEach } from 'vitest'

import { runTestCases } from '@/test'

import type { Store } from './store.types'
import type { DocumentRecord } from '@/project'
import type { BaseTestCase } from '@/test'
import type { AnyRawRecord, RecordPatch } from '@/types'

type TestCase = BaseTestCase & {
	attributes: AnyRawRecord['attributes']
	patch: Omit<RecordPatch, 'recordId'>
	expectedAttributes: AnyRawRecord['attributes']
}

const DOCUMENT: DocumentRecord = {
	id: 'doc-1',
	name: 'patched',
	extension: '.xml',
	configKey: 'test',
	createdAt: 0,
}

const RECORD_ID = 'record-1'

const STORE_FACTORIES: Record<string, () => Store> = {
	InMemoryStore: () => new InMemoryStore('bulk-write-patch', { writable: true }),
	DexieStore: () => new DexieStore(`bulk-write-patch-${crypto.randomUUID()}`),
}

const testCases: Record<string, TestCase> = {
	'record with aA and bA, patch removes aA -> bA kept, aA gone': {
		attributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'bA', value: 'b' },
		],
		patch: { removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'b' }],
	},
	'record without aA, patch removes aA -> attributes unchanged': {
		attributes: [{ name: 'bA', value: 'b' }],
		patch: { removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'b' }],
	},
	'patch sets bA and removes aA -> bA updated, aA gone': {
		attributes: [
			{ name: 'aA', value: 'a' },
			{ name: 'bA', value: 'b' },
		],
		patch: { attributes: [{ name: 'bA', value: 'B' }], removeAttributes: ['aA'] },
		expectedAttributes: [{ name: 'bA', value: 'B' }],
	},
	'patch sets and removes aA -> aA gone, removal applies after the merge': {
		attributes: [{ name: 'aA', value: 'a' }],
		patch: { attributes: [{ name: 'aA', value: 'A' }], removeAttributes: ['aA'] },
		expectedAttributes: [],
	},
}

for (const [storeName, createStore] of Object.entries(STORE_FACTORIES)) {
	describe(`${storeName} bulkWrite update patch`, () => {
		let store: Store | undefined

		afterEach(async () => {
			await store?.destroy()
			store = undefined
		})

		runTestCases.generic(testCases, async (testCase) => {
			store = createStore()
			await store.open()
			await store.registerDocument(DOCUMENT)
			await store.bulkWrite(DOCUMENT.id, { creates: [makeRecord(testCase.attributes)] })

			await store.bulkWrite(DOCUMENT.id, {
				updates: [{ recordId: RECORD_ID, ...testCase.patch }],
			})

			const stored = await store.get(RECORD_ID, DOCUMENT.id)
			expect(stored?.attributes).toEqual(testCase.expectedAttributes)
			expect(stored).not.toHaveProperty('removeAttributes')
		})
	})
}

function makeRecord(attributes: AnyRawRecord['attributes']): AnyRawRecord {
	return {
		id: RECORD_ID,
		tagName: 'A',
		namespace: { prefix: '', uri: '' },
		attributes,
		value: '',
		parent: null,
		children: [],
	}
}
