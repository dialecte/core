import { AFTER_IMPORT_ATTRIBUTE } from './bench.constants'

import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { FixtureRoot, StageTiming } from './bench.types'
import type { PerfSnapshot } from '@/perf'
import type { StoreRuntime } from '@/project/io/store-runtime.types'
import type { AnyDialecteConfig, ImportSession, RecordPatch } from '@/types'

/** The core test config parsing every element of the file as unknown (returned verbatim). */
export function benchConfig(params: {
	rootElementName: string
	namespaceUri: string
}): AnyDialecteConfig {
	return {
		...TEST_DIALECTE_CONFIG,
		rootElementName: params.rootElementName,
		namespaces: {
			...TEST_DIALECTE_CONFIG.namespaces,
			default: { uri: params.namespaceUri, prefix: '' },
		},
	} as unknown as AnyDialecteConfig
}

/**
 * Replays a dialecte's write-back volume: `ratio` of the records get one attribute patched after the
 * import, as a reference fill does. Also stops the import with a parse failure when asked.
 */
export function createWriteBackSession(params: {
	ratio: number
	failAfterRecords?: number
	onRoot: (id: string) => void
	timings: { afterImportBuildMs: number }
}): ImportSession {
	const { ratio, failAfterRecords, onRoot, timings } = params
	const picked: string[] = []
	let credit = 0
	let seen = 0
	return {
		beforeImportRecord: function benchSessionBeforeRecord({ record }) {
			seen += 1
			if (failAfterRecords !== undefined && seen >= failAfterRecords)
				throw new Error(`bench failure after ${seen} records`)
			if (record.parent === null) onRoot(record.id)
			credit += ratio
			if (credit >= 1) {
				credit -= 1
				picked.push(record.id)
			}
		},
		afterImport: async function benchSessionAfterImport() {
			const startedAt = performance.now()
			const updates: RecordPatch[] = picked.map((recordId, index) => ({
				recordId,
				attributes: [{ name: AFTER_IMPORT_ATTRIBUTE, value: `ref-${index}` }],
			}))
			timings.afterImportBuildMs += performance.now() - startedAt
			return { updates }
		},
	}
}

/** What the engine bench imports with: the verbatim config of the file's root, the write-back session, perf on. */
export function createBenchImportRuntime(params: {
	root: FixtureRoot
	afterImportRatio: number
}): StoreRuntime {
	const { root, afterImportRatio } = params
	return {
		configs: { default: benchConfig(root) },
		defaultConfigKey: 'default',
		hooks: {
			createImportSession: function createBenchSession() {
				return createWriteBackSession({
					ratio: afterImportRatio,
					onRoot: () => undefined,
					timings: { afterImportBuildMs: 0 },
				})
			},
		},
		perf: true,
	}
}

/** An import's stages from its perf snapshot: each span name summed, and each tally. */
export function stagesOf(params: {
	snapshot: PerfSnapshot | undefined
}): Record<string, StageTiming> {
	const { snapshot } = params
	const stages: Record<string, StageTiming> = {}
	for (const span of snapshot?.spans ?? []) {
		const stage = (stages[span.name] ??= { calls: 0, totalMs: 0 })
		stage.calls += 1
		stage.totalMs += span.duration
	}
	for (const [name, { calls, totalMs }] of Object.entries(snapshot?.totals ?? {})) {
		stages[name] = { calls, totalMs }
	}
	return stages
}
