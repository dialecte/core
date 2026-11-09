/** A test tier: T0 static checks, T1 node on in-memory, T2 node store legs, T3 browser-only, T4 browser store legs. */
export type TestTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4'

/** A browser tier: the tiers the selection decides file by file. */
export type BrowserTier = Extract<TestTier, 'T3' | 'T4'>

/** What changed since the base: the files (from the package root), or why they could not be listed. */
export type ScopeChanges =
	| { kind: 'files'; files: readonly string[] }
	| { kind: 'unknown'; reason: string }

/** A file the browser project runs for this change, and why. */
export type SelectedBrowserFile = {
	/** From the package root. */
	path: string
	tier: BrowserTier
	/** Each reason the file is selected, in plain words (the changed file and the edge that reaches it). */
	reasons: string[]
}

/** What a change runs: every tier selected, and the browser files with their reasons. */
export type TestSelection = {
	tiers: TestTier[]
	browserFiles: SelectedBrowserFile[]
}

/** A file that reaches the tests through no import (a config, a build plugin, the lock): it selects every browser file. */
export type NonImportEdge = {
	/** A glob from the package root; it must name at least one file. */
	pattern: string
	/** Why a change there can change what a browser test does. */
	why: string
}

/** What a run starts in the browser project: its files, and a note when they are not the selection itself. */
export type BrowserRun = {
	files: string[]
	note?: string
}

/** What `--selection-out` writes: the base, what changed, the selection and what the run starts. */
export type SelectionReport = {
	base: string
	changes: ScopeChanges
	tiers: TestTier[]
	browserFiles: SelectedBrowserFile[]
	run: BrowserRun
}

/** A local specifier (relative or `@/`) that names no file of the package. */
export type UnresolvedSpecifier = {
	/** The file holding it, from the package root. */
	from: string
	specifier: string
}

/** An unresolved specifier the package keeps on purpose, and why. */
export type KnownUnresolvedSpecifier = UnresolvedSpecifier & { why: string }

/** The base a run compared with (the first that resolved) and what changed since it. */
export type ChangesSinceBase = {
	base: string
	changes: ScopeChanges
}
