/**
 * The generated stress fixture the scenario benches read: four blocks of the generator's shape (a binary tree of
 * depth 10 per block, about 2,000 records each), small enough for the node suite.
 */
export const SCENARIO_FIXTURE_BYTES = 400_000

/** How many elements a scenario works on (values looked up, leaves, scope roots, references rewritten). */
export const SCENARIO_ELEMENTS = 16

/** The deepest elements of the first block: 512 records at depth 10 of it, twelve ancestors each (the block's ten, its root and the document root). */
export const SCENARIO_LEAF_TAG = 'DDDDDDDDDDD_1'

/** The leaf tag's attribute the lookups and the rename read and write. */
export const SCENARIO_LEAF_ATTRIBUTE = 'aDDDDDDDDDDD_1'

/** Scope roots at depth 5 of the first block: 16 records, each over 32 leaves of the leaf tag. */
export const SCENARIO_SCOPE_TAG = 'DDDDDD_1'

/** A node at depth 6 of the first block: its subtree holds 16 leaves (both sibling tags) sharing their ancestors. */
export const SCENARIO_FETCH_ROOT_TAG = 'DDDDDDD_1'

/** How long generating, importing and measuring the fixture may take on a loaded machine (a few seconds when quiet). */
export const SCENARIO_BENCH_TIMEOUT_MS = 120_000

/** The store reads whose answered records the recording store logs. */
export const RECORDED_STORE_READS: ReadonlySet<PropertyKey> = new Set([
	'get',
	'getMany',
	'getByTagNameInDocument',
	'getByDocumentId',
])
