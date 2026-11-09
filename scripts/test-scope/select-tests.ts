import { matchesGlob } from 'node:path'

import { BROWSER_ONLY_TEST_FILES } from '../../vitest.config.constants'
import { browserTierOf } from './browser-tier-of'
import { importClosureOf } from './import-closure'
import {
	ALWAYS_RUN_TIERS,
	BROWSER_TIERS,
	NON_IMPORT_EDGES,
	SOURCE_FOLDER,
} from './test-scope.constants'

import type {
	BrowserTier,
	ScopeChanges,
	SelectedBrowserFile,
	TestSelection,
	TestTier,
} from './test-scope.types'

/** Why a change selects every browser file: each changed file of a non-import edge, with the edge's reason. */
function everyFileReasonsOf(params: { changes: ScopeChanges }): string[] {
	const { changes } = params
	if (changes.kind === 'unknown') return [`the changes are unknown: ${changes.reason}`]
	return changes.files.flatMap(function reasonsOf(file) {
		return NON_IMPORT_EDGES.filter((edge) => matchesGlob(file, edge.pattern)).map(
			(edge) => `${file} changed (${edge.why})`,
		)
	})
}

/** Why a T3 file runs: each changed file under `src/`. */
function sourceReasonsOf(params: { files: readonly string[] }): string[] {
	return params.files
		.filter((file) => file.startsWith(SOURCE_FOLDER))
		.map((file) => `${file} changed (a source file)`)
}

/** Why a T4 file runs: it changed, or a changed file is in its import closure (one reason per changed file). */
function storeReasonsOf(params: {
	root: string
	path: string
	files: readonly string[]
	edgeCache: Map<string, readonly string[]>
}): string[] {
	const { root, path, files, edgeCache } = params
	const closure = importClosureOf({ root, files: [path], edgeCache })
	return files.flatMap(function reasonOf(file) {
		if (file === path) return [`${path} changed`]
		return closure.has(file) ? [`${file} changed, in its import closure`] : []
	})
}

function reasonsOf(params: {
	root: string
	path: string
	tier: BrowserTier
	changes: ScopeChanges
	everyFileReasons: readonly string[]
	edgeCache: Map<string, readonly string[]>
}): string[] {
	const { root, path, tier, changes, everyFileReasons, edgeCache } = params
	if (everyFileReasons.length > 0 || changes.kind === 'unknown') return [...everyFileReasons]
	if (tier === 'T3') return sourceReasonsOf({ files: changes.files })
	return storeReasonsOf({ root, path, files: changes.files, edgeCache })
}

/**
 * The tiers and browser files a change runs. T0-T2 always; the T3 files whenever a file under `src/` changed; a T4 file
 * when it changed itself or a changed file is in its import closure; every browser file when a file of a non-import
 * edge (a config, a build plugin, the dependencies) changed, or when the changes are unknown. Browser files come in the
 * config's order.
 */
export function selectTests(params: { root: string; changes: ScopeChanges }): TestSelection {
	const { root, changes } = params
	const everyFileReasons = everyFileReasonsOf({ changes })
	// the browser files share most of their closures: each file of the tree is read once per selection
	const edgeCache = new Map<string, readonly string[]>()
	const browserFiles: SelectedBrowserFile[] = BROWSER_ONLY_TEST_FILES.flatMap(function selected({
		path,
	}) {
		const tier = browserTierOf({ path })
		const reasons = reasonsOf({ root, path, tier, changes, everyFileReasons, edgeCache })
		return reasons.length > 0 ? [{ path, tier, reasons }] : []
	})
	const selectedTiers = new Set(browserFiles.map((file) => file.tier))
	const tiers: TestTier[] = [
		...ALWAYS_RUN_TIERS,
		...BROWSER_TIERS.filter((tier) => selectedTiers.has(tier)),
	]
	return { tiers, browserFiles }
}
