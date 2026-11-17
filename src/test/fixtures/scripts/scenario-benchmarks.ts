import {
	SCENARIO_ELEMENTS,
	SCENARIO_FETCH_ROOT_TAG,
	SCENARIO_LEAF_ATTRIBUTE,
	SCENARIO_LEAF_TAG,
	SCENARIO_SCOPE_TAG,
} from './scenario-benchmarks.constants'

import type {
	FetchRepeats,
	ReadLog,
	ScenarioBaseline,
	ScenarioDocument,
	StoreTallies,
} from './scenario-benchmarks.types'
import type { PerfReport } from '@/perf'
import type { AnyTrackedRecord, AnyTreeRecord } from '@/types'

/**
 * Run the scenario benches on a document imported from the generated stress fixture, with dev perf on and its store
 * logging the records its reads answer into `log`. Each scenario's store calls and records moved are its
 * `core::store::*` tallies; the one-fetch scenario adds the records it read more than once. Plain data, frozen as
 * the baseline a later change compares its counts with.
 */
export async function measureScenarios(params: {
	document: ScenarioDocument
	log: ReadLog
}): Promise<ScenarioBaseline> {
	const { document, log } = params
	const query = document.query.any
	const [root] = await query.getRecordsByTagName('Root')
	const [fetchRoot] = await query.getRecordsByTagName(SCENARIO_FETCH_ROOT_TAG)
	const scopeRoots = await query.getRecordsByTagName(SCENARIO_SCOPE_TAG)
	const wholeTree = await query.getTree(root)
	const fetchTree = await query.getTree(fetchRoot)
	const leaves = leavesOf(fetchTree)

	const scenarios: Record<string, StoreTallies> = {}
	scenarios['findByAttributes, one call per value'] = await measure({
		document,
		run: function lookups() {
			return lookUpEachValue({ document })
		},
	})
	scenarios['findByAttributes, one call with a list of values'] = await measure({
		document,
		run: function lookupOfAllValues() {
			return lookUpAllValues({ document })
		},
	})
	scenarios['findAncestors of each leaf'] = await measure({
		document,
		run: function ancestors() {
			return ancestorsOfEach({ document, leaves })
		},
	})
	scenarios['findDescendants under each scope root'] = await measure({
		document,
		run: function descendants() {
			return descendantsUnderEach({ document, scopeRoots })
		},
	})
	scenarios['findDescendantsOfEach over the scope roots'] = await measure({
		document,
		run: function descendantsOfEach() {
			return descendantsUnderAll({ document, scopeRoots })
		},
	})
	scenarios['getTree with a narrow select'] = await measure({
		document,
		run: function narrowTree() {
			return treeOfOneBranch({ document, root })
		},
	})
	const fetchStart = log.keys.length
	scenarios['one fetch over the leaves of a subtree'] = await measure({
		document,
		run: function fetch() {
			return fetchLeaves({ document, leaves })
		},
	})
	const fetchRepeats = repeatsOf({ keys: log.keys.slice(fetchStart) })
	scenarios['rename rewriting references in one transaction'] = await measure({
		document,
		run: function rename() {
			return rewriteReferences({ document })
		},
	})

	return {
		fixture: { records: sizeOf(wholeTree), elementsPerScenario: SCENARIO_ELEMENTS },
		scenarios,
		fetchRepeats,
	}
}

/** The `core::store::*` tallies `run` adds to the document's dev perf, without the prefix, by name. */
async function measure(params: {
	document: ScenarioDocument
	run: () => Promise<void>
}): Promise<StoreTallies> {
	const { document, run } = params
	document.perf.reset()
	await run()
	return storeTallies({ report: document.perf.report() })
}

function storeTallies(params: { report: PerfReport }): StoreTallies {
	const prefix = 'core::store::'
	return Object.fromEntries(
		Object.entries(params.report)
			.filter(([name, entry]) => name.startsWith(prefix) && entry.count !== undefined)
			.map(([name, entry]) => [name.slice(prefix.length), entry.count ?? 0] as const)
			.sort(([left], [right]) => left.localeCompare(right)),
	)
}

/** One lookup per value, as a per-element loop resolving references by name issues them (no value matches). */
async function lookUpEachValue(params: { document: ScenarioDocument }): Promise<void> {
	for (let index = 0; index < SCENARIO_ELEMENTS; index++) {
		// dialecte-allow query-in-loop: the scenario measures what a per-element loop of lookups costs
		await params.document.query.any.findByAttributes({
			tagName: SCENARIO_LEAF_TAG,
			attributes: { [SCENARIO_LEAF_ATTRIBUTE]: `value-${index}` },
		})
	}
}

/** The same values as `lookUpEachValue`, looked up in one call with a list. */
async function lookUpAllValues(params: { document: ScenarioDocument }): Promise<void> {
	const values = Array.from({ length: SCENARIO_ELEMENTS }, (_, index) => `value-${index}`)
	await params.document.query.any.findByAttributes({
		tagName: SCENARIO_LEAF_TAG,
		attributes: { [SCENARIO_LEAF_ATTRIBUTE]: values },
	})
}

async function ancestorsOfEach(params: {
	document: ScenarioDocument
	leaves: AnyTreeRecord[]
}): Promise<void> {
	for (const leaf of params.leaves) {
		// dialecte-allow query-in-loop: the scenario measures what one ancestor walk per leaf costs
		await params.document.query.any.findAncestors(leaf)
	}
}

/** A flat collect of the leaf tag under each scope root (none of them the document root). */
async function descendantsUnderEach(params: {
	document: ScenarioDocument
	scopeRoots: AnyTrackedRecord[]
}): Promise<void> {
	for (const scopeRoot of params.scopeRoots) {
		// dialecte-allow query-in-loop: the scenario measures what one descendant collect per scope root costs
		await params.document.query.findDescendants(scopeRoot as never, {
			collect: SCENARIO_LEAF_TAG as never,
		})
	}
}

/** The same flat collect under every scope root in one call. */
async function descendantsUnderAll(params: {
	document: ScenarioDocument
	scopeRoots: AnyTrackedRecord[]
}): Promise<void> {
	await params.document.query.findDescendantsOfEach(params.scopeRoots as never, {
		collect: SCENARIO_LEAF_TAG as never,
	})
}

/** The document root with one branch of the first block selected, two levels deep. */
async function treeOfOneBranch(params: {
	document: ScenarioDocument
	root: AnyTrackedRecord
}): Promise<void> {
	await params.document.query.any.getTree(params.root, { select: { D: { DD_1: true } } as never })
}

/** What a view loading the leaves of one subtree reads: each leaf, its ancestors, and its parent's children. */
async function fetchLeaves(params: {
	document: ScenarioDocument
	leaves: AnyTreeRecord[]
}): Promise<void> {
	const query = params.document.query.any
	for (const leaf of params.leaves) {
		// dialecte-allow query-in-loop: the scenario measures the reads a per-leaf view load repeats
		await query.getRecord({ tagName: leaf.tagName, id: leaf.id })
		// dialecte-allow query-in-loop: the scenario measures the reads a per-leaf view load repeats
		const [parent] = await query.findAncestors(leaf)
		// dialecte-allow query-in-loop: the scenario measures the reads a per-leaf view load repeats
		await query.getChildren(parent, leaf.tagName)
	}
}

/** One transaction looks the references up once, then rewrites `SCENARIO_ELEMENTS` of them, as a rename does. */
async function rewriteReferences(params: { document: ScenarioDocument }): Promise<void> {
	await params.document.transaction(async function rewrite(tx) {
		const references = await tx.any.findByAttributes({
			tagName: SCENARIO_LEAF_TAG,
			attributes: { [SCENARIO_LEAF_ATTRIBUTE]: 'x' },
		})
		for (const reference of references.slice(0, SCENARIO_ELEMENTS)) {
			await tx.any.update(reference, { attributes: { [SCENARIO_LEAF_ATTRIBUTE]: 'renamed' } })
		}
	})
}

function repeatsOf(params: { keys: string[] }): FetchRepeats {
	const moved = params.keys.length
	const distinct = new Set(params.keys).size
	return { moved, distinct, repeated: moved - distinct }
}

function leavesOf(tree: AnyTreeRecord | undefined): AnyTreeRecord[] {
	if (!tree) return []
	if (tree.tree.length === 0) return [tree]
	return tree.tree.flatMap(leavesOf)
}

function sizeOf(tree: AnyTreeRecord | undefined): number {
	if (!tree) return 0
	return tree.tree.reduce((total, child) => total + sizeOf(child), 1)
}
