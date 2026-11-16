/**
 * The publish guard's decision for a push to main, as pure functions: `_check-npm-version.yml` runs it through
 * `scripts/publish-guard/run-publish-decision.ts`, which gathers the facts.
 */
import { NPM_NOT_FOUND, SEMVER } from './publish-decision.constants.ts'

import type {
	DistTag,
	NpmViewResult,
	PublishDecision,
	PublishFacts,
	RegistryState,
	SemVer,
} from './publish-decision.types.ts'

/** What npm answered: read, absent on a first publish (E404), failed on any other error. */
export function readNpmView(result: NpmViewResult): RegistryState {
	if (result.exitCode !== 0) {
		if (NPM_NOT_FOUND.test(result.stdout) || NPM_NOT_FOUND.test(result.stderr))
			return { kind: 'absent' }
		return { kind: 'failed', reason: npmErrorReason(result) }
	}
	if (result.stdout.trim() === '') return { kind: 'absent' }
	const parsed = parseJson(result.stdout)
	if (!isRecord(parsed))
		return { kind: 'failed', reason: `unreadable npm view output: ${result.stdout.trim()}` }
	return {
		kind: 'present',
		distTags: readDistTags(parsed['dist-tags']),
		versions: readVersions(parsed.versions),
	}
}

/**
 * Publish, tag only, skip or refuse. Only the push that changes the version acts. A version npm has is never published
 * again: its missing tag is pushed when npm's tag for it names it (a re-run after the publish), else nothing. A new
 * version must be above npm's latest; a pre-release goes under next.
 */
export function decidePublish(facts: PublishFacts): PublishDecision {
	const { previousVersion, currentVersion, registry, tagExists } = facts
	if (registry.kind === 'failed')
		return { action: 'refuse', reason: `npm view failed: ${registry.reason}` }
	if (previousVersion === currentVersion)
		return { action: 'skip', reason: `version unchanged (${currentVersion})` }
	const current = parseSemVer(currentVersion)
	if (current === undefined)
		return { action: 'refuse', reason: `${currentVersion} is not a semver version` }
	const distTag: DistTag = current.prerelease.length > 0 ? 'next' : 'latest'
	if (registry.kind === 'absent')
		return { action: 'publish', distTag, reason: `first publish of ${currentVersion}` }
	if (registry.versions.includes(currentVersion))
		return decidePublished({ registry, currentVersion, distTag, tagExists })
	const latest = registry.distTags.latest
	const latestVersion = latest === undefined ? undefined : parseSemVer(latest)
	if (
		latest !== undefined &&
		(latestVersion === undefined || compareSemVer(current, latestVersion) <= 0)
	) {
		return { action: 'refuse', reason: `${currentVersion} is not above npm's latest ${latest}` }
	}
	return {
		action: 'publish',
		distTag,
		reason: `${previousVersion} -> ${currentVersion} under ${distTag}`,
	}
}

/** A version npm has: tag it when its tag is missing and npm's tag for it names it, else nothing. */
function decidePublished(params: {
	registry: Extract<RegistryState, { kind: 'present' }>
	currentVersion: string
	distTag: DistTag
	tagExists: boolean
}): PublishDecision {
	const { registry, currentVersion, distTag, tagExists } = params
	if (!tagExists && registry.distTags[distTag] === currentVersion) {
		return {
			action: 'tag',
			reason: `npm has ${currentVersion} under ${distTag}, its release tag is missing`,
		}
	}
	return { action: 'skip', reason: `npm has ${currentVersion}` }
}

/** The parts of a semver version, or undefined when it is not one. */
function parseSemVer(version: string): SemVer | undefined {
	const match = SEMVER.exec(version)
	if (match === null) return undefined
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] === undefined ? [] : match[4].split('.'),
	}
}

/** Semver precedence: negative when the first is below the second, 0 when equal, positive above. */
function compareSemVer(first: SemVer, second: SemVer): number {
	const coreOrder = first.core
		.map((part, index) => part - (second.core[index] ?? 0))
		.find((difference) => difference !== 0)
	if (coreOrder !== undefined) return coreOrder
	if (first.prerelease.length === 0 || second.prerelease.length === 0) {
		return second.prerelease.length - first.prerelease.length
	}
	const length = Math.max(first.prerelease.length, second.prerelease.length)
	const order = Array.from({ length }, (_, index) =>
		comparePrereleasePart({ first: first.prerelease[index], second: second.prerelease[index] }),
	).find((difference) => difference !== 0)
	return order ?? 0
}

/** One pre-release identifier against another: absent first, numbers before words, numbers by value. */
function comparePrereleasePart(params: {
	first: string | undefined
	second: string | undefined
}): number {
	const { first, second } = params
	if (first === undefined || second === undefined) {
		return first === undefined ? (second === undefined ? 0 : -1) : 1
	}
	const firstNumeric = /^\d+$/.test(first)
	const secondNumeric = /^\d+$/.test(second)
	if (firstNumeric && secondNumeric) return Number(first) - Number(second)
	if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1
	return first < second ? -1 : first > second ? 1 : 0
}

/** npm's error as `<code>: <summary>`, else its stderr, else the exit code. */
function npmErrorReason(result: NpmViewResult): string {
	const parsed = parseJson(result.stdout)
	const error = isRecord(parsed) ? parsed.error : undefined
	if (isRecord(error) && typeof error.code === 'string' && typeof error.summary === 'string') {
		return `${error.code}: ${error.summary}`
	}
	const stderr = result.stderr.trim()
	return stderr === '' ? `npm view exited ${result.exitCode}` : stderr
}

/** The dist-tags npm printed, string values only. */
function readDistTags(value: unknown): Readonly<Partial<Record<string, string>>> {
	if (!isRecord(value)) return {}
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		),
	)
}

/** The versions npm printed: an array, or one string when the package has one version. */
function readVersions(value: unknown): readonly string[] {
	if (typeof value === 'string') return [value]
	return Array.isArray(value)
		? value.filter((version): version is string => typeof version === 'string')
		: []
}

/** JSON text parsed, or undefined when it is not JSON. */
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

/** Whether a value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
