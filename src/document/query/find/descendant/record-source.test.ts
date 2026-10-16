import { READS_BEFORE_SIZING, createRecordSource } from './record-source'

import { describe, expect, it } from 'vitest'

import { createStagedOperations } from '@/document'
import { NOOP_PROGRESS_REPORTER } from '@/document/progress'
import { stageOperation } from '@/document/transaction/stage-operations'
import { createPerf } from '@/perf'
import { InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { Context, Ref } from '@/document'
import type { Perf } from '@/perf'
import type { TestDialecteConfig } from '@/test'
import type { AnyRawRecord, ElementsOf } from '@/types'

type AnyRef = Ref<TestDialecteConfig, ElementsOf<TestDialecteConfig>>

const DOCUMENT_ID = 'doc'

/** `Root` (id `root`) holding one child per tag name given, child `r<n>` of tag `tags[n]`. */
function flatDocument(tags: string[]): AnyRawRecord[] {
	const children = tags.map((tagName, index) => ({
		id: `r${index}`,
		tagName,
		namespace: { prefix: '', uri: '' },
		attributes: [],
		value: '',
		parent: { id: 'root', tagName: 'Root' },
		children: [],
	}))
	const root = {
		id: 'root',
		tagName: 'Root',
		namespace: { prefix: '', uri: '' },
		attributes: [],
		value: '',
		parent: null,
		children: children.map(({ id, tagName }) => ({ id, tagName })),
	}
	return [root, ...children] as unknown as AnyRawRecord[]
}

/** A context over a real in-memory store holding `records`, its store reads counted. */
async function createSourceContext(
	records: AnyRawRecord[],
): Promise<{ context: Context<TestDialecteConfig>; perf: Perf }> {
	const store = new InMemoryStore('record-source', { writable: true })
	await store.registerDocument({
		id: DOCUMENT_ID,
		name: 'doc',
		extension: '.xml',
		configKey: 'default',
		createdAt: 0,
		status: 'ready',
	})
	await store.bulkWrite(DOCUMENT_ID, { creates: records })
	const perf = createPerf({ enabled: true })
	const context = {
		store,
		dialecteConfig: TEST_DIALECTE_CONFIG,
		documentId: DOCUMENT_ID,
		recordCache: undefined,
		stagedOperations: createStagedOperations<TestDialecteConfig>(),
		progress: NOOP_PROGRESS_REPORTER,
		perf,
	} as unknown as Context<TestDialecteConfig>
	return { context, perf }
}

function counted(perf: Perf, name: string): number {
	return perf.report()[name]?.count ?? 0
}

function ref(tagName: string, id: string): AnyRef {
	return { tagName, id } as AnyRef
}

describe('record source - store reads', () => {
	it('tag reads past the floor → one document read, the remaining tags come from memory', async () => {
		const tags = Array.from({ length: READS_BEFORE_SIZING + 40 }, (_, index) => `T${index}`)
		const { context, perf } = await createSourceContext(flatDocument(tags))
		const source = createRecordSource({ context })

		for (const [index, tagName] of tags.entries()) {
			const records = await source.byTag(tagName as ElementsOf<TestDialecteConfig>)
			expect(
				records.map(({ id }) => id),
				`records of ${tagName}`,
			).toEqual([`r${index}`])
		}

		expect(counted(perf, 'core::store::getByDocumentId')).toBe(1)
		expect(counted(perf, 'core::store::getByTagName')).toBeLessThanOrEqual(READS_BEFORE_SIZING)
	})

	it('records staged in the transaction → served without a store read, never counted toward the switch', async () => {
		const tags = Array.from({ length: READS_BEFORE_SIZING + 40 }, () => 'AA_1')
		const { context, perf } = await createSourceContext(flatDocument([]))
		for (const record of flatDocument(tags).slice(1)) {
			stageOperation({ context, status: 'created', record: record as never })
		}
		const source = createRecordSource({ context })

		for (const index of tags.keys()) {
			expect((await source.get(ref('AA_1', `r${index}`)))?.status).toBe('created')
		}

		expect(counted(perf, 'core::store::get')).toBe(0)
		expect(counted(perf, 'core::store::count')).toBe(0)
		expect(counted(perf, 'core::store::getByDocumentId')).toBe(0)
	})

	it('getMany with a repeated id → the record is read once and returned at both places', async () => {
		const { context, perf } = await createSourceContext(flatDocument(['AA_1', 'AA_2']))
		const source = createRecordSource({ context })

		const records = await source.getMany([ref('AA_1', 'r0'), ref('AA_1', 'r0'), ref('AA_2', 'r1')])

		expect(records.map((record) => record?.id)).toEqual(['r0', 'r0', 'r1'])
		expect(counted(perf, 'core::store::get')).toBe(2)
	})
})

describe('record source - a ref whose tag name differs from the stored record', () => {
	const mismatch = { cause: { key: 'ELEMENT_TAGNAME_MISMATCH' } }

	it('first read → ELEMENT_TAGNAME_MISMATCH', async () => {
		const { context } = await createSourceContext(flatDocument(['AA_1']))
		const source = createRecordSource({ context })

		await expect(source.get(ref('AA_2', 'r0'))).rejects.toMatchObject(mismatch)
	})

	it('record already read under its own tag → ELEMENT_TAGNAME_MISMATCH, not the memoized record', async () => {
		const { context } = await createSourceContext(flatDocument(['AA_1']))
		const source = createRecordSource({ context })
		await source.get(ref('AA_1', 'r0'))

		await expect(source.get(ref('AA_2', 'r0'))).rejects.toMatchObject(mismatch)
	})

	it('after the document read → ELEMENT_TAGNAME_MISMATCH, not undefined', async () => {
		const tags = Array.from({ length: READS_BEFORE_SIZING + 40 }, () => 'AA_1')
		const { context, perf } = await createSourceContext(flatDocument(tags))
		const source = createRecordSource({ context })
		for (const index of tags.keys()) await source.get(ref('AA_1', `r${index}`))
		expect(counted(perf, 'core::store::getByDocumentId')).toBe(1)

		await expect(source.get(ref('AA_2', 'r0'))).rejects.toMatchObject(mismatch)
		await expect(source.getMany([ref('AA_2', 'r1')])).rejects.toMatchObject(mismatch)
	})
})
