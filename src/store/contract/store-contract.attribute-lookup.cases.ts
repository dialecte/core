import { STORE_ATTRIBUTE_QUERY_CONTRACT } from './store-contract.attribute-query.cases'
import { commit, deletedRef, makeDocument, makeRecord } from './store-contract.fixtures'

import { expect } from 'vitest'

import type { AttributeLookup, Store } from '../store.types'
import type { StoreContractCases, StoreContractGroups } from './store-contract.types'
import type { AnyAttribute, AnyRawRecord } from '@/types'

const DOCUMENT_ID = 'doc-1'

/** A record of tag `A` (unless another is named) holding these attributes, plain unless one names its namespace. */
function recordWith(params: {
	id: string
	attributes: AnyAttribute[]
	tagName?: string
}): AnyRawRecord {
	const { id, attributes, tagName = 'A' } = params
	return makeRecord({ id, tagName, attributes })
}

/** The document registered and holding the records, written out of id order by the caller. */
async function seed(params: { store: Store; records: AnyRawRecord[] }): Promise<void> {
	const { store, records } = params
	await store.registerDocument(makeDocument())
	await store.bulkWrite(DOCUMENT_ID, { creates: records })
}

/** The ids the store's attribute lookup answers on the document (of tag `A` unless another is named). */
async function idsOf(params: {
	store: Store
	attributes: AttributeLookup['attributes']
	tagName?: string
	documentId?: string
}): Promise<string[]> {
	const { store, attributes, tagName = 'A', documentId = DOCUMENT_ID } = params
	// a leg without the member fails here: its cases run as pending until it serves the lookup
	const records = await store.getByAttributes!({ documentId, tagName, attributes })
	return records.map((record) => record.id)
}

/** `x`, `m`, `c` of A and `b` of B with `k` and `l` values, written out of id order. */
const SEEDED: AnyRawRecord[] = [
	recordWith({
		id: 'x',
		attributes: [
			{ name: 'k', value: '1' },
			{ name: 'l', value: 'p' },
		],
	}),
	recordWith({
		id: 'm',
		attributes: [
			{ name: 'k', value: '2' },
			{ name: 'l', value: 'p' },
		],
	}),
	recordWith({ id: 'c', attributes: [{ name: 'k', value: '1' }] }),
	recordWith({ id: 'b', tagName: 'B', attributes: [{ name: 'k', value: '1' }] }),
]

const lookups: StoreContractCases = {
	'one value → the records of the tag holding it, in id order, no other tag': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			await expect(idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })).resolves.toEqual([
				'c',
				'x',
			])
		},
	},
	'a list of values → the records holding any of them, in id order': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			await expect(
				idsOf({ store, attributes: [{ name: 'k', values: ['2', '1', 'none'] }] }),
			).resolves.toEqual(['c', 'm', 'x'])
		},
	},
	'two attributes → the records holding both': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			await expect(
				idsOf({
					store,
					attributes: [
						{ name: 'k', values: ['1'] },
						{ name: 'l', values: ['p'] },
					],
				}),
			).resolves.toEqual(['x'])
		},
	},
	'an attribute no record holds, a tag with no record, a document not in the store → nothing': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			async function answers(): Promise<Record<string, string[]>> {
				return {
					absentAttribute: await idsOf({ store, attributes: [{ name: 'z', values: ['1'] }] }),
					absentTag: await idsOf({
						store,
						tagName: 'C',
						attributes: [{ name: 'k', values: ['1'] }],
					}),
					absentDocument: await idsOf({
						store,
						documentId: 'nope',
						attributes: [{ name: 'k', values: ['1'] }],
					}),
				}
			}
			await expect(answers()).resolves.toEqual({
				absentAttribute: [],
				absentTag: [],
				absentDocument: [],
			})
		},
	},
	'values with quotes, a backslash, unicode, a very long one → each matched exactly, not by case or prefix':
		{
			needs: ['attribute-lookup'],
			act: async ({ store }) => {
				const long = 'v'.repeat(10_000)
				const values = ['a"b', "a'b", 'a\\b', 'é😀', long]
				await seed({
					store,
					records: [
						...values.map((value, index) =>
							recordWith({ id: `r${index}`, attributes: [{ name: 'k', value }] }),
						),
						recordWith({ id: 'upper', attributes: [{ name: 'k', value: 'A"B' }] }),
						recordWith({ id: 'longer', attributes: [{ name: 'k', value: `${long}v` }] }),
					],
				})
				const each = Promise.all(
					values.map((value) => idsOf({ store, attributes: [{ name: 'k', values: [value] }] })),
				)
				await expect(each).resolves.toEqual([['r0'], ['r1'], ['r2'], ['r3'], ['r4']])
			},
		},
	'a record holding two values of one name, or two attributes of that name → one row': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({
				store,
				records: [
					recordWith({
						id: 'twice',
						attributes: [
							{ name: 'k', value: '1', namespace: { prefix: 'f', uri: 'urn:f' } },
							{ name: 'k', value: '2' },
						],
					}),
					recordWith({
						id: 'same',
						attributes: [
							{ name: 'k', value: '1', namespace: { prefix: 'f', uri: 'urn:f' } },
							{ name: 'k', value: '1' },
						],
					}),
				],
			})
			await expect(
				idsOf({ store, attributes: [{ name: 'k', values: ['1', '2'] }] }),
			).resolves.toEqual(['same', 'twice'])
		},
	},
	'no attribute entry → nothing (a lookup needs at least one)': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			await expect(idsOf({ store, attributes: [] })).resolves.toEqual([])
		},
	},
	'the same value given twice → each record once': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			await expect(
				idsOf({ store, attributes: [{ name: 'k', values: ['1', '1'] }] }),
			).resolves.toEqual(['c', 'x'])
		},
	},
}

const afterWrites: StoreContractCases = {
	'a lookup, then a bulk write creating, patching and deleting → the next lookup follows': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			async function beforeAndAfter(): Promise<Record<string, string[]>> {
				const before = await idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
				await store.bulkWrite(DOCUMENT_ID, {
					creates: [recordWith({ id: 'a', attributes: [{ name: 'k', value: '1' }] })],
					updates: [{ recordId: 'm', attributes: [{ name: 'k', value: '1' }] }],
					deletes: ['x'],
				})
				const after = await idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
				return { before, after }
			}
			await expect(beforeAndAfter()).resolves.toEqual({
				before: ['c', 'x'],
				after: ['a', 'c', 'm'],
			})
		},
	},
	'a bulk-write patch moving a record to another tag → looked up under the new tag only': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			async function afterMove(): Promise<Record<string, string[]>> {
				await idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
				await store.bulkWrite(DOCUMENT_ID, { updates: [{ recordId: 'c', tagName: 'B' }] })
				return {
					A: await idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] }),
					B: await idsOf({ store, tagName: 'B', attributes: [{ name: 'k', values: ['1'] }] }),
				}
			}
			await expect(afterMove()).resolves.toEqual({ A: ['x'], B: ['b', 'c'] })
		},
	},
	'a commit creating, updating and deleting, its undo, its redo → the lookup follows each step': {
		needs: ['attribute-lookup', 'history'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			function lookUp(): Promise<string[]> {
				return idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
			}
			async function eachStep(): Promise<Record<string, string[]>> {
				const seeded = await lookUp()
				await commit({
					store,
					documentId: DOCUMENT_ID,
					creates: [recordWith({ id: 'z', attributes: [{ name: 'k', value: '1' }] })],
					updates: [recordWith({ id: 'c', attributes: [{ name: 'k', value: '3' }] })],
					deletes: [deletedRef('x')],
				})
				const committed = await lookUp()
				await store.undo(DOCUMENT_ID)
				const undone = await lookUp()
				await store.redo(DOCUMENT_ID)
				const redone = await lookUp()
				return { seeded, committed, undone, redone }
			}
			await expect(eachStep()).resolves.toEqual({
				seeded: ['c', 'x'],
				committed: ['z'],
				undone: ['c', 'x'],
				redone: ['z'],
			})
		},
	},
	'the document removed, then registered again → its lookups answer nothing': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			async function afterRemoval(): Promise<string[]> {
				await idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
				await store.removeDocument(DOCUMENT_ID)
				await store.registerDocument(makeDocument())
				return idsOf({ store, attributes: [{ name: 'k', values: ['1'] }] })
			}
			await expect(afterRemoval()).resolves.toEqual([])
		},
	},
	'a lookup answer changed by the caller → the next lookup answers as before': {
		needs: ['attribute-lookup'],
		act: async ({ store }) => {
			await seed({ store, records: SEEDED })
			const lookup = {
				documentId: DOCUMENT_ID,
				tagName: 'A',
				attributes: [{ name: 'k', values: ['1'] }],
			}
			async function readTwice(): Promise<AnyRawRecord[]> {
				const first = await store.getByAttributes!(lookup)
				first[0]!.attributes[0]!.value = 'changed'
				return store.getByAttributes!(lookup)
			}
			// c then x, as seeded
			await expect(readTwice()).resolves.toEqual([SEEDED[2], SEEDED[0]])
		},
	},
}

/**
 * The attribute lookup of a store that has one (exact on stored strings, in id order, kept on every write path), and
 * `findByAttributes` over any store: the same records in the same order, with its lookup or without.
 */
export const STORE_ATTRIBUTE_CONTRACT: StoreContractGroups = {
	'attribute lookups': lookups,
	'attribute lookups after writes': afterWrites,
	...STORE_ATTRIBUTE_QUERY_CONTRACT,
}
