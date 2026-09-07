import { describe, expect, it } from 'vitest'

/**
 * IndexedDB-vs-inMemory import benchmark — runs in core's browser vitest (real Chromium,
 * real IndexedDB via Dexie). Node can't measure the `local` store (no IndexedDB), so the
 * store comparison must happen here. Both stores run in the SAME engine, so the delta is
 * pure store cost, not node-vs-browser.
 *
 * Gated by `VITE_BENCH` so the normal suite skips it. Needs the stress fixtures generated
 * first (`generate-stress-fixtures.ts` → git-ignored `data/`). Run:
 *
 *   npx vitest run --mode bench src/test/fixtures/idb-import.bench.test.ts
 *
 * Read `[IDB-BENCH]` lines from the browser console output. Big sizes (100+ MB) may exceed
 * browser memory/quota — start with 5/10/50.
 */
import { Project } from '@/project/project'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const SIZES = [5, 10, 50]
// Gate: only runs under `--mode bench` so the normal suite / CI skips the heavy imports.
const RUN = import.meta.env.MODE === 'bench'

async function loadFixture(mb: number): Promise<string> {
	const res = await fetch(new URL(`./data/stress-${mb}mb.xml`, import.meta.url))
	if (!res.ok) throw new Error(`fixture ${mb}MB missing (${res.status}) — generate it first`)
	return res.text()
}

async function benchImport(mb: number, storage: 'inMemory' | 'local'): Promise<string> {
	const xml = await loadFixture(mb)
	performance.clearMarks()
	performance.clearMeasures()

	const project = await new Project({
		configs: { default: CONFIG },
		defaultConfigKey: 'default',
		storage: storage === 'local' ? { type: 'local' } : { type: 'inMemory' },
		dev: { perf: true },
	}).open(`idb-${storage}-${mb}-${crypto.randomUUID()}`)

	const t = performance.now()
	const [imp] = await project.import([new File([xml], 'b.xml', { type: 'text/xml' })], {
		useCustomRecordsIds: false,
	})
	const importMs = performance.now() - t
	const doc = project.openDocument(imp.documentId)

	const report = doc.perf.report()
	const p = (n: string): string => report[n]?.totalMs?.toFixed(0) ?? 'n/a'
	// Round to reduce snapshot churn; bucket import to nearest 50 ms, spans to nearest 10 ms.
	const line = `${storage} ${mb}MB: import ~${(Math.round(importMs / 50) * 50).toFixed(0)}ms | sax ~${p('core::import::sax')} | bulkWrite ~${p('core::store::bulkWrite')} | ${(mb / (importMs / 1000)).toFixed(1)} MB/s`

	await project.destroy()
	return line
}

describe('import bench — IndexedDB vs inMemory (browser)', () => {
	// IndexedDB is far slower — cap it at sizes that finish under the timeout (50 MB does not).
	const LOCAL_SIZES = [5, 10]
	for (const mb of SIZES) {
		it.runIf(RUN)(
			`inMemory ${mb}MB`,
			async () => {
				expect(await benchImport(mb, 'inMemory')).toMatchInlineSnapshot()
			},
			600_000,
		)
	}
	for (const mb of LOCAL_SIZES) {
		it.runIf(RUN)(
			`local(IDB) ${mb}MB`,
			async () => {
				expect(await benchImport(mb, 'local')).toMatchInlineSnapshot()
			},
			600_000,
		)
	}
})
