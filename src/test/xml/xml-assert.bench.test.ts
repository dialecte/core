import { createXmlAssertions } from '../assert-xml'
import { DIALECTE_TEST_NAMESPACES } from '../constant'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The budget of the XML assertions on a big file: parse and one expected query on the generated 5 MB stress
// fixture, in Node, the median of five warm runs. The fixture is generated into a temporary folder and removed.
// Runs under `--mode bench` (or VITE_BENCH=1), in Node.
const RUN = import.meta.env.MODE === 'bench' || import.meta.env.VITE_BENCH === '1'

const FIXTURE_BYTES = 5 * 1024 * 1024
const BUDGET_MILLISECONDS = 200
const WARM_RUNS = 5
// depth 1 of the first branch: `D` then `DD_1`, each with the generator's two attributes
const EXPECTED_QUERY = '//default:Root/default:D[@aD="x"]/default:DD_1[@aDD_1="x"]'

const { assertExpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_TEST_NAMESPACES,
})

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.floor(sorted.length / 2)]!
}

describe.skipIf(!RUN)('the XML assertions on a 5 MB export', () => {
	let folder = ''
	let xml = ''

	// Node modules and the generator are loaded here, so the file imports cleanly where it is skipped (a browser)
	beforeAll(async () => {
		const { mkdtemp, readFile } = await import('node:fs/promises')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const { generateStressXml } = await import('../fixtures/generate-stress-fixtures')
		folder = await mkdtemp(join(tmpdir(), 'dialecte-xml-budget-'))
		const outPath = join(folder, 'stress-5mb.xml')
		await generateStressXml({ outPath, targetBytes: FIXTURE_BYTES })
		xml = await readFile(outPath, 'utf8')
	}, 60_000)

	afterAll(async () => {
		const { rm } = await import('node:fs/promises')
		await rm(folder, { recursive: true, force: true })
	})

	it('parse + one expected query → under the budget, warm median of five runs', () => {
		assertExpectedElementQueries({ xml, queries: [EXPECTED_QUERY] })
		const durations = Array.from({ length: WARM_RUNS }, function timeOneRun() {
			const startedAt = performance.now()
			assertExpectedElementQueries({ xml, queries: [EXPECTED_QUERY] })
			return performance.now() - startedAt
		})
		expect(median(durations)).toBeLessThan(BUDGET_MILLISECONDS)
	})
})
