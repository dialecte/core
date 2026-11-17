import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateStressXml } from '../generate-stress-fixtures'
import { recordingStore } from './recording-store'
import { measureScenarios } from './scenario-benchmarks'
import { SCENARIO_BENCH_TIMEOUT_MS, SCENARIO_FIXTURE_BYTES } from './scenario-benchmarks.constants'

import { describe, expect, it } from 'vitest'

import { InMemoryStore } from '@/store'
import { TEST_DIALECTE, createTestProject } from '@/test'

import type { ReadLog } from './scenario-benchmarks.types'

// The store calls and records moved of each scenario on the generated stress fixture, frozen in
// benchmarks/scenarios/baseline.json: a change that moves a count shows it in that file's diff. The query layer
// counts them; they are the in-memory store's (a lookup it answers with getByAttributes, a store without that
// member answers with a tag read).
describe('scenario benches', () => {
	it(
		'each scenario on the generated stress fixture → its store calls and records moved equal the frozen baseline',
		async () => {
			const folder = await mkdtemp(join(tmpdir(), 'dialecte-scenario-bench-'))
			try {
				const outPath = join(folder, 'stress.xml')
				await generateStressXml({ outPath, targetBytes: SCENARIO_FIXTURE_BYTES })
				const sourceXml = await readFile(outPath, 'utf8')
				const log: ReadLog = { keys: [] }
				const inMemory = new InMemoryStore(`scenario-${crypto.randomUUID()}`, {
					dialecteId: TEST_DIALECTE.id,
					runtime: {
						configs: TEST_DIALECTE.configs,
						defaultConfigKey: TEST_DIALECTE.defaultConfigKey,
					},
				})
				const store = recordingStore({ store: inMemory, log })
				const { source } = await createTestProject({
					sourceXml,
					storage: { type: 'custom', store },
					dev: { perf: true },
				})

				const baseline = await measureScenarios({ document: source.document, log })

				await expect(`${JSON.stringify(baseline, null, '\t')}\n`).toMatchFileSnapshot(
					'../../../../benchmarks/scenarios/baseline.json',
				)
			} finally {
				await rm(folder, { recursive: true, force: true })
			}
		},
		SCENARIO_BENCH_TIMEOUT_MS,
	)
})
