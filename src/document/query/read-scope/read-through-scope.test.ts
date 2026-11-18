import { fakeVersionedStore, plainRecord, scopedContext } from './read-scope.fixtures'
import { readThroughScope } from './read-through-scope'

import { describe, expect, expectTypeOf, it } from 'vitest'

import type { CachedContext } from '@/document'
import type { VersionedRead } from '@/store'
import type { TestDialecteConfig } from '@/test'
import type { AnyRawRecord } from '@/types'

// The reader behind every store read of the query layer, on a store answering versioned reads: what a scope answers
// again, what it keeps, and what it never mixes. A call sees a snapshot of what it already read until a miss or a
// told change; a miss of another version resets the scope.
describe('readThroughScope', () => {
	function valuesOf(answer: unknown): (string | undefined)[] {
		return (answer as (AnyRawRecord | undefined)[]).map((record) => record?.attributes[0]?.value)
	}

	it('a by-id list partly held, the epoch moving while the rest is read → every record of the list, read again whole', async () => {
		const fake = fakeVersionedStore({
			records: [plainRecord({ id: 'a', value: 'a0' }), plainRecord({ id: 'b', value: 'b0' })],
		})
		const { context, moveEpoch } = scopedContext({ store: fake.store })
		await readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })
		const release = fake.holdNextRead()

		const list = readThroughScope({
			context,
			read: { member: 'getMany', args: [['a', 'b'], 'doc'] },
		})
		await Promise.resolve()
		fake.records.set('a', plainRecord({ id: 'a', value: 'a1' }))
		moveEpoch()
		await readThroughScope({ context, read: { member: 'get', args: ['c', 'doc'] } })
		release()
		const answer = await list

		expect(valuesOf(answer)).toEqual(['a1', 'b0'])
	})

	it('a by-id list partly held, the store at another version → the list read again whole, one moment', async () => {
		const fake = fakeVersionedStore({
			records: [plainRecord({ id: 'a', value: 'a0' }), plainRecord({ id: 'b', value: 'b0' })],
		})
		const { context } = scopedContext({ store: fake.store })
		await readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })
		fake.records.set('a', plainRecord({ id: 'a', value: 'a1' }))
		fake.version.count = 1

		const list = await readThroughScope({
			context,
			read: { member: 'getMany', args: [['a', 'b'], 'doc'] },
		})

		expect({ values: valuesOf(list), asked: fake.calls.map((call) => call.args[0]) }).toEqual({
			values: ['a1', 'b0'],
			asked: ['a', ['b'], ['a', 'b']],
		})
	})

	it('an older answer arriving after a newer one → returned, not kept, the newer kept', async () => {
		const fake = fakeVersionedStore({
			records: [plainRecord({ id: 'a', value: 'a0' }), plainRecord({ id: 'b', value: 'b0' })],
		})
		const { context, scope } = scopedContext({ store: fake.store })
		const release = fake.holdNextRead()
		const older = readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })
		await Promise.resolve()
		fake.version.count = 1
		await readThroughScope({ context, read: { member: 'get', args: ['b', 'doc'] } })
		release()
		await older

		await readThroughScope({ context, read: { member: 'get', args: ['b', 'doc'] } })
		await readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })

		expect({ version: scope.version, asked: fake.calls.map((call) => call.args[0]) }).toEqual({
			version: { engineId: 'engine-1', count: 1 },
			asked: ['a', 'b', 'a'],
		})
	})

	it('an answer of another engine → the scope reset to it', async () => {
		const fake = fakeVersionedStore({ records: [plainRecord({ id: 'a', value: 'a0' })] })
		const { context, scope } = scopedContext({ store: fake.store })
		fake.version.count = 5
		await readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })
		fake.version.engineId = 'engine-2'
		fake.version.count = 0

		await readThroughScope({ context, read: { member: 'get', args: ['b', 'doc'] } })
		await readThroughScope({ context, read: { member: 'get', args: ['a', 'doc'] } })

		expect({ version: scope.version, reads: fake.calls.length }).toEqual({
			version: { engineId: 'engine-2', count: 0 },
			reads: 3,
		})
	})

	it('the same attribute lookup twice → one store read, copies answered', async () => {
		const fake = fakeVersionedStore({
			records: [plainRecord({ id: 'a', value: 'x' }), plainRecord({ id: 'b', value: 'y' })],
		})
		const { context } = scopedContext({ store: fake.store })
		const lookup = { documentId: 'doc', tagName: 'A', attributes: [{ name: 'aA', values: ['x'] }] }

		const first = await readThroughScope({
			context,
			read: { member: 'getByAttributes', args: [lookup] },
		})
		const second = await readThroughScope({
			context,
			read: { member: 'getByAttributes', args: [lookup] },
		})

		expect({
			ids: (second as AnyRawRecord[]).map((record) => record.id),
			same: first === second,
			reads: fake.calls.length,
		}).toEqual({
			ids: ['a'],
			same: false,
			reads: 1,
		})
	})

	it('a tag read after the whole document was read → answered from it, in id order', async () => {
		const fake = fakeVersionedStore({
			records: [
				plainRecord({ id: 'c', value: 'c' }),
				plainRecord({ id: 'b', value: 'b', tagName: 'B' }),
				plainRecord({ id: 'a', value: 'a' }),
			],
		})
		const { context } = scopedContext({ store: fake.store })
		await readThroughScope({ context, read: { member: 'getByDocumentId', args: ['doc'] } })

		const tag = await readThroughScope({
			context,
			read: { member: 'getByTagNameInDocument', args: ['A', 'doc'] },
		})

		expect({
			ids: (tag as AnyRawRecord[]).map((record) => record.id),
			reads: fake.calls.length,
		}).toEqual({
			ids: ['a', 'c'],
			reads: 1,
		})
	})

	it('a list answer mutated by its caller → the next answer from the scope unchanged', async () => {
		const fake = fakeVersionedStore({ records: [plainRecord({ id: 'a', value: 'a0' })] })
		const { context } = scopedContext({ store: fake.store })
		const read: VersionedRead = { member: 'getByTagNameInDocument', args: ['A', 'doc'] }

		const first = (await readThroughScope({ context, read })) as AnyRawRecord[]
		first[0].attributes[0].value = 'mutated'
		const second = await readThroughScope({ context, read })

		expect(valuesOf(second)).toEqual(['a0'])
	})

	it('a transaction context → no read scope in its type', () => {
		expectTypeOf<CachedContext<TestDialecteConfig>['readScope']>().toEqualTypeOf<undefined>()
	})
})
