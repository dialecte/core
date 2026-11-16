/** What `npm view <package> dist-tags versions --json` gave: its exit code and both streams. */
export type NpmViewResult = {
	exitCode: number
	stdout: string
	stderr: string
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
