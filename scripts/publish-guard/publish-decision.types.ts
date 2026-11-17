/** What a command gave (`npm view`, `git show`, `git ls-remote`): its exit code and both streams. */
export type CommandResult = {
	exitCode: number
	stdout: string
	stderr: string
}

/** What the publish decision reads and writes, given by its caller: the real process, or a test's fakes. */
export type PublishDecisionIo = {
	environment: Readonly<Partial<Record<string, string>>>
	readFile: (path: string) => string
	run: (params: { command: string; args: readonly string[] }) => CommandResult
	appendOutput: (params: { file: string; text: string }) => void
	print: (params: { stream: 'stdout' | 'stderr'; line: string }) => void
}

/**
 * What npm holds for the package: nothing (never published), its dist-tags and versions, or a query that failed (the
 * guard fails closed on it).
 */
export type RegistryState =
	| { kind: 'absent' }
	| {
			kind: 'present'
			distTags: Readonly<Partial<Record<string, string>>>
			versions: readonly string[]
	  }
	| { kind: 'failed'; reason: string }

/** The npm dist-tag a version is published under: a release is the latest, a pre-release the next. */
export type DistTag = 'latest' | 'next'

/** A semver version for ordering: major, minor and patch, and the pre-release identifiers (none for a release). */
export type SemVer = {
	core: readonly [number, number, number]
	prerelease: readonly string[]
}

/** What the push to main knows when it decides: the version before and after the push, npm, and the release tag. */
export type PublishFacts = {
	previousVersion: string
	currentVersion: string
	registry: RegistryState
	tagExists: boolean
}

/**
 * What the push does: publish (then tag), push the missing tag of a version npm has, nothing, or refuse (the run
 * fails, with the reason).
 */
export type PublishDecision =
	| { action: 'publish'; distTag: DistTag; reason: string }
	| { action: 'tag'; reason: string }
	| { action: 'skip'; reason: string }
	| { action: 'refuse'; reason: string }
