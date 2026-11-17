import { InMemoryStore } from './in-memory-store'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { TEST_CONFIG_KEY, TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

/** The generated stress fixture the tag-read bench imports: 50 MB of XML. */
const TAG_READ_FIXTURE_BYTES = 50 * 1024 * 1024

/** Warm reads per tag; the bench takes their median. */
const TAG_READ_WARM_RUNS = 21

/**
 * A read of a one-record tag on the 50 MB document, median of warm runs: an O(tag) read answers in microseconds, a
 * walk of the whole document takes milliseconds.
 */
const SMALL_TAG_READ_BUDGET_MS = 1

/** The bench's import and generation ceiling. */
const TAG_READ_SETUP_TIMEOUT_MS = 10 * 60_000

// The in-memory tag read on the generated 50 MB stress fixture, in Node: a one-record tag (the root) answered under
// a budget only a read of the tag meets, and the largest tag timed for the record. The fixture is generated into a
// temporary folder and removed. Runs under `--mode bench` (or VITE_BENCH=1): `npm run test:perf:node`.
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.floor(sorted.length / 2)]!
}

/** The median of warm reads of the tag, after one cold read. */
async function timeTagRead(params: {
	store: InMemoryStore
	tagName: string
	documentId: string
}): Promise<number> {
	const { store, tagName, documentId } = params
	await store.getByTagNameInDocument(tagName, documentId)
	const durations: number[] = []
	for (let run = 0; run < TAG_READ_WARM_RUNS; run++) {
		const startedAt = performance.now()
		await store.getByTagNameInDocument(tagName, documentId)
		durations.push(performance.now() - startedAt)
	}
	return median(durations)
}

describe.skipIf(!RUN)('the in-memory tag read on a 50 MB document', () => {
	let folder = ''
	let documentId = ''
	let largestTag = { tagName: '', records: 0 }
	const store = new InMemoryStore('in-memory-tag-read-bench', {
		runtime: {
			configs: { [TEST_CONFIG_KEY]: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
			defaultConfigKey: TEST_CONFIG_KEY,
			perf: false,
		},
	})

	// Node modules and the generator are loaded here, so the file imports cleanly where it is skipped (a browser)
	beforeAll(async () => {
		const { mkdtemp, readFile } = await import('node:fs/promises')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const { generateStressXml } = await import('@/test/fixtures/generate-stress-fixtures')
		folder = await mkdtemp(join(tmpdir(), 'dialecte-tag-read-'))
		const outPath = join(folder, 'stress-50mb.xml')
		await generateStressXml({ outPath, targetBytes: TAG_READ_FIXTURE_BYTES })
		const bytes = await readFile(outPath)
		await store.open()
		const imported = await store.importFile({ file: new File([bytes], 'stress-50mb.xml') })
		documentId = imported.record.id
		const records = await store.getByDocumentId(documentId)
		const tagCounts = new Map<string, number>()
		for (const record of records)
			tagCounts.set(record.tagName, (tagCounts.get(record.tagName) ?? 0) + 1)
		const [tagName, count] = [...tagCounts].sort((left, right) => right[1] - left[1])[0]!
		largestTag = { tagName, records: count }
		console.info(`[tag-read] ${records.length} records, largest tag ${tagName}: ${count}`)
	}, TAG_READ_SETUP_TIMEOUT_MS)

	afterAll(async () => {
		const { rm } = await import('node:fs/promises')
		await store.destroy()
		await rm(folder, { recursive: true, force: true })
	})

	it('the root tag (one record) → under its O(tag) budget, warm median', async () => {
		const rootMs = await timeTagRead({ store, tagName: 'Root', documentId })
		const largestMs = await timeTagRead({ store, tagName: largestTag.tagName, documentId })
		console.info(
			`[tag-read] Root ${rootMs.toFixed(3)} ms; ${largestTag.tagName} (${largestTag.records}) ${largestMs.toFixed(1)} ms`,
		)
		expect(rootMs).toBeLessThan(SMALL_TAG_READ_BUDGET_MS)
	})
})
