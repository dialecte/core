import { runExport } from '../run-export'
/**
 * Export budget bench: the store's export of a 50 MB document (the core structural and the composed SCL fixtures,
 * imported into an in-memory store; the composed one also once from the local store, for information) and of two
 * 500 MB documents made on read (no store memory): unknown elements in a binary tree (the read calls of a real SCL
 * file), and the core test dialecte's own elements (schema attributes and sequence ordering). Timed runs start on a
 * quiet machine; one instrumented run per 50 MB fixture splits the time by stage. One result file per document with
 * the machine load. Runs only under `--mode bench`; the composed fixtures come from `BENCH_SCL_FIXTURES_DIR`:
 *
 *   BENCH_SCL_FIXTURES_DIR=<dir> VITE_BENCH=1 \
 *     nice -n 10 npx vitest run --project perf --mode bench src/project/io/bench/export.bench.test.ts
 */
import {
	EXPORT_BENCH_FIXTURES,
	EXPORT_BENCH_LOCAL_FIXTURE,
	EXPORT_BENCH_QUIET_LOAD,
	EXPORT_BENCH_QUIET_WAIT_MS,
	EXPORT_BENCH_RUNS,
	EXPORT_BENCH_TIMEOUT_MS,
	EXPORT_BUDGET_MS,
	EXPORT_STAGES,
	GENERATED_KNOWN_FAN_OUTS,
	GENERATED_UNKNOWN_FAN_OUTS,
} from './export-bench.constants'
import { createGeneratedExportSource } from './generated-export-source'

import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import { InMemoryStore } from '@/store/in-memory'
import { DexieStore } from '@/store/local'
import { FIXTURE_ROOTS } from '@/store/sqlite/bench/bench.constants'
import { TEST_CONFIG_KEY, TEST_DIALECTE_CONFIG } from '@/test'

import type { StoreRuntime } from '../store-runtime.types'
import type { ExportBenchRun, ExportStageSplit, GeneratedShape } from './export-bench.types'
import type { PerfSnapshot } from '@/perf'
import type { Store } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

/** The core test dialecte rooted and namespaced as the fixture is: every other element is read as unknown. */
function runtimeOf(params: {
	rootElementName: string
	namespaceUri: string
	perf: boolean
}): StoreRuntime {
	const { rootElementName, namespaceUri, perf } = params
	const config = {
		...TEST_DIALECTE_CONFIG,
		rootElementName,
		namespaces: { ...TEST_DIALECTE_CONFIG.namespaces, default: { prefix: '', uri: namespaceUri } },
		io: { ...TEST_DIALECTE_CONFIG.io, supportedFileExtensions: ['.xml', '.scd'] },
	} as unknown as AnyDialecteConfig
	return { configs: { [TEST_CONFIG_KEY]: config }, defaultConfigKey: TEST_CONFIG_KEY, perf }
}

function median(values: number[]): number {
	const sorted = [...values].sort((first, second) => first - second)
	return sorted[Math.floor(sorted.length / 2)]!
}

/** The time of each stage (spans summed; `export::write` is a tally) and what no stage holds. */
function stageSplitOf(params: { perf: PerfSnapshot }): ExportStageSplit {
	const { perf } = params
	const stages: ExportStageSplit['stages'] = {}
	for (const stage of EXPORT_STAGES) {
		const spans = perf.spans.filter(
			(span) => span.name.endsWith(`::${stage}`) || span.name === stage,
		)
		const tallyKey = Object.keys(perf.totals).find((key) => key.endsWith(stage))
		const tally = tallyKey ? perf.totals[tallyKey] : undefined
		stages[stage] = spans.length
			? {
					calls: spans.length,
					totalMs: Math.round(spans.reduce((sum, span) => sum + span.duration, 0)),
				}
			: { calls: tally?.calls ?? 0, totalMs: Math.round(tally?.totalMs ?? 0) }
	}
	const parts = EXPORT_STAGES.slice(1).reduce((sum, stage) => sum + stages[stage]!.totalMs, 0)
	return { stages, unattributedMs: stages.export!.totalMs - parts }
}

async function waitForQuiet() {
	return commands.benchWaitForQuiet({
		maxLoad: EXPORT_BENCH_QUIET_LOAD,
		maxWaitMs: EXPORT_BENCH_QUIET_WAIT_MS,
	})
}

/** Import a fixture into a store; its record count checked against the fixture's. */
async function importFixture(params: {
	store: Store
	url: string
	records: number
}): Promise<string> {
	const { store, url, records } = params
	const response = await fetch(url)
	const file = new File([await response.blob()], url.split('/').at(-1)!)
	const imported = await store.importFile({ file })
	expect(imported.recordCount).toBe(records)
	return imported.record.id
}

async function benchInMemory(params: (typeof EXPORT_BENCH_FIXTURES)[number]): Promise<void> {
	const fixture = await commands.benchFixture({ name: params.name })
	const roots = FIXTURE_ROOTS[params.family]
	const name = `export-bench-${crypto.randomUUID()}`
	const timed = new InMemoryStore(name, { runtime: runtimeOf({ ...roots, perf: false }) })
	const instrumented = new InMemoryStore(name, {
		runtime: runtimeOf({ ...roots, perf: true }),
	})
	await timed.open()
	await instrumented.open()
	try {
		const documentId = await importFixture({
			store: timed,
			url: fixture.url,
			records: fixture.records,
		})
		const runs: ExportBenchRun[] = []
		for (let index = 0; index < EXPORT_BENCH_RUNS; index++) {
			const machine = await waitForQuiet()
			const startedAt = performance.now()
			const { file } = await timed.exportFile({ documentId })
			runs.push({ totalMs: Math.round(performance.now() - startedAt), bytes: file.size, machine })
		}
		const instrumentedMachine = await waitForQuiet()
		const { perf } = await instrumented.exportFile({ documentId })
		const medianMs = median(runs.map((run) => run.totalMs))
		await commands.benchRecord({
			name: `export-${params.name}`,
			data: {
				fixture,
				store: 'in-memory',
				device: await commands.benchDevice(),
				medianMs,
				runs,
				instrumented: { machine: instrumentedMachine, ...stageSplitOf({ perf: perf! }) },
			},
		})
		expect(medianMs).toBeLessThanOrEqual(EXPORT_BUDGET_MS[50])
	} finally {
		await timed.destroy()
		instrumented.close()
	}
}

async function benchGenerated(params: {
	name: string
	shape: GeneratedShape
	config: AnyDialecteConfig
}) {
	const { name, shape, config } = params
	const runtime: StoreRuntime = {
		configs: { [TEST_CONFIG_KEY]: config },
		defaultConfigKey: TEST_CONFIG_KEY,
	}
	const { source, stats, totalRecords } = createGeneratedExportSource({
		shape,
		documentId: 'generated',
	})
	const machine = await waitForQuiet()
	const startedAt = performance.now()
	const { file } = await runExport({ source, runtime, documentId: 'generated' })
	const totalMs = performance.now() - startedAt
	await commands.benchRecord({
		name: `export-${name}`,
		data: {
			device: await commands.benchDevice(),
			totalRecords,
			totalMs: Math.round(totalMs),
			bytes: file.size,
			machine,
			machineAfter: await commands.benchMachine(),
			source: { ...stats, makeMs: Math.round(stats.makeMs) },
		},
	})
	expect(totalMs).toBeLessThanOrEqual(EXPORT_BUDGET_MS[500])
}

describe.runIf(RUN)('export budget', () => {
	for (const fixture of EXPORT_BENCH_FIXTURES) {
		it(
			`${fixture.name} in memory -> exported within ${EXPORT_BUDGET_MS[50] / 1000} s`,
			() => benchInMemory(fixture),
			EXPORT_BENCH_TIMEOUT_MS,
		)
	}

	it(
		`${EXPORT_BENCH_LOCAL_FIXTURE.name} on the local store -> its export time recorded (not gated)`,
		async function benchLocal() {
			const fixture = await commands.benchFixture({ name: EXPORT_BENCH_LOCAL_FIXTURE.name })
			const roots = FIXTURE_ROOTS[EXPORT_BENCH_LOCAL_FIXTURE.family]
			const store = new DexieStore(`export-bench-${crypto.randomUUID()}`, {
				runtime: runtimeOf({ ...roots, perf: false }),
			})
			await store.open()
			try {
				const documentId = await importFixture({
					store,
					url: fixture.url,
					records: fixture.records,
				})
				const machine = await waitForQuiet()
				const startedAt = performance.now()
				const { file } = await store.exportFile({ documentId })
				await commands.benchRecord({
					name: `export-${fixture.name}-local`,
					data: {
						fixture,
						store: 'local (IndexedDB)',
						device: await commands.benchDevice(),
						totalMs: Math.round(performance.now() - startedAt),
						bytes: file.size,
						machine,
					},
				})
			} finally {
				await store.destroy()
			}
		},
		EXPORT_BENCH_TIMEOUT_MS,
	)

	it(
		`generated 500 MB of unknown elements, half of them parents -> exported within ${EXPORT_BUDGET_MS[500] / 1000} s`,
		() =>
			benchGenerated({
				name: 'generated-500-unknown',
				shape: {
					fanOuts: GENERATED_UNKNOWN_FAN_OUTS,
					namespace: TEST_DIALECTE_CONFIG.namespaces.default,
				},
				config: runtimeOf({
					rootElementName: 'L0',
					namespaceUri: TEST_DIALECTE_CONFIG.namespaces.default.uri,
					perf: false,
				}).configs[TEST_CONFIG_KEY]!,
			}),
		EXPORT_BENCH_TIMEOUT_MS,
	)

	it(
		`generated 500 MB of the dialecte's own elements -> exported within ${EXPORT_BUDGET_MS[500] / 1000} s`,
		() =>
			benchGenerated({
				name: 'generated-500-known',
				shape: {
					fanOuts: GENERATED_KNOWN_FAN_OUTS,
					namespace: TEST_DIALECTE_CONFIG.namespaces.default,
					config: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig,
				},
				config: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig,
			}),
		EXPORT_BENCH_TIMEOUT_MS,
	)
})
