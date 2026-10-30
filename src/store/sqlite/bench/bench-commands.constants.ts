// The bench's node side (its vitest browser commands): nothing here reaches the library's sources, so the vitest
// config that loads the commands stays a node-only program.
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The core package's root, from this folder. */
export const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Where the generated structural and compact fixtures are read. */
export const CORE_FIXTURES = join(CORE_ROOT, 'src/test/fixtures/data')

/** How many functions, by self time, the GC share lists. */
export const PROFILE_TOP_FUNCTIONS = 25
/** Bytes the fixture scanner looks at (record count, compact arm). */
export const XML_BYTES = {
	lt: 0x3c,
	gt: 0x3e,
	slash: 0x2f,
	bang: 0x21,
	question: 0x3f,
	quote: 0x22,
	apostrophe: 0x27,
} as const

/** How to get a fixture the bench reads (said when one is missing). */
export const FIXTURE_SOURCES = {
	structural: 'generate it with src/test/fixtures/generate-stress-fixtures.ts',
	composed: 'composed fixtures are read from the folder named by BENCH_SCL_FIXTURES_DIR',
	compact:
		'write it from its indented source: drop every whitespace-only text run, trim every text value, copy markup as is (the record count must not change)',
} as const
