/**
 * The publish guard's decision for a push to main: `_check-npm-version.yml` runs
 * `scripts/publish-guard/run-publish-decision.ts`, which gives `runPublishDecision` the real process. Everything here
 * reads and writes only through the io it is given.
 */
import {
	LS_REMOTE_FOUND,
	LS_REMOTE_MISSING,
	NPM_NOT_FOUND,
	SEMVER,
} from './publish-decision.constants.ts'

import type {
	CommandResult,
	DistTag,
	PublishDecision,
	PublishDecisionIo,
	PublishFacts,
	RegistryState,
	SemVer,
} from './publish-decision.types.ts'

/** What npm answered: read, absent on a first publish (E404), failed on any other error. */
export function readNpmView(result: CommandResult): RegistryState {
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
 * again: when its release tag is missing, the push tags its own commit, the one that brings that version (a re-run of
 * the release push, or a revert to a published version whose tag was lost). A release tag without its version on npm is
 * refused. A new version must be above npm's latest, and a pre-release above npm's next too; a pre-release goes under
 * next.
 */
export function decidePublish(facts: PublishFacts): PublishDecision {
	const { previousVersion, currentVersion, registry, tagExists } = facts
	if (previousVersion === currentVersion) return unchangedDecision(currentVersion)
	if (registry.kind === 'failed')
		return { action: 'refuse', reason: `npm view failed: ${registry.reason}` }
	const current = parseSemVer(currentVersion)
	if (current === undefined)
		return { action: 'refuse', reason: `${currentVersion} is not a semver version` }
	if (registry.kind === 'present' && registry.versions.includes(currentVersion)) {
		return tagExists
			? { action: 'skip', reason: `npm has ${currentVersion} and its release tag` }
			: { action: 'tag', reason: `npm has ${currentVersion}, its release tag is missing` }
	}
	if (tagExists) {
		return {
			action: 'refuse',
			reason: `the release tag of ${currentVersion} exists but npm lacks the version`,
		}
	}
	const distTag: DistTag = current.prerelease.length > 0 ? 'next' : 'latest'
	if (registry.kind === 'absent')
		return { action: 'publish', distTag, reason: `first publish of ${currentVersion}` }
	const floors: readonly DistTag[] = distTag === 'next' ? ['latest', 'next'] : ['latest']
	const refusal = floors
		.map((floor) =>
			floorRefusal({ current, currentVersion, floor, floorVersion: registry.distTags[floor] }),
		)
		.find((reason) => reason !== undefined)
	if (refusal !== undefined) return { action: 'refuse', reason: refusal }
	return {
		action: 'publish',
		distTag,
		reason: `${previousVersion} -> ${currentVersion} under ${distTag}`,
	}
}

/** git ls-remote --exit-code: the tag found (0) or missing (2); any other exit throws with git's reason. */
export function lsRemoteState(result: { exitCode: number; stderr: string }): 'found' | 'missing' {
	if (result.exitCode === LS_REMOTE_FOUND) return 'found'
	if (result.exitCode === LS_REMOTE_MISSING) return 'missing'
	throw new Error(`git ls-remote exited ${result.exitCode}: ${result.stderr.trim()}`)
}

/** The step outputs of a decision: dist_tag only when it publishes. */
export function outputsOf(decision: PublishDecision): string {
	const publish = decision.action === 'publish'
	const distTag = decision.action === 'publish' ? `dist_tag=${decision.distTag}\n` : ''
	const tag = publish || decision.action === 'tag'
	return `publish=${publish}\n${distTag}tag=${tag}\n`
}

/**
 * The push's decision through the io it is given: the version before the push (from BEFORE) against the current one;
 * npm and the release tag are asked only when the version changed. Prints the decision; a refusal returns 1 with no
 * outputs written, anything else writes the outputs and returns 0. A missing BEFORE or GITHUB_OUTPUT, an unreadable
 * package.json or a failed git command throws.
 */
export function runPublishDecision(io: PublishDecisionIo): number {
	const before = io.environment.BEFORE ?? ''
	const outputFile = io.environment.GITHUB_OUTPUT ?? ''
	if (before === '' || outputFile === '') throw new Error('BEFORE and GITHUB_OUTPUT must be set')
	const current = readPackage(io.readFile('package.json'))
	const previous = readPackage(
		stdoutOf({ io, command: 'git', args: ['show', `${before}:package.json`] }),
	)
	const decision =
		previous.version === current.version
			? unchangedDecision(current.version)
			: decidePublish({
					previousVersion: previous.version,
					currentVersion: current.version,
					registry: readNpmView(
						io.run({
							command: 'npm',
							args: ['view', current.name, 'dist-tags', 'versions', '--json'],
						}),
					),
					tagExists: tagOnOrigin({ io, tag: releaseTagOf(current) }) === 'found',
				})
	io.print({
		stream: decision.action === 'refuse' ? 'stderr' : 'stdout',
		line: `${current.name} ${previous.version} -> ${current.version}: ${decision.action} (${decision.reason})`,
	})
	if (decision.action === 'refuse') return 1
	io.appendOutput({ file: outputFile, text: outputsOf(decision) })
	return 0
}

/** A push that leaves the version as it was: nothing to publish or tag, npm not asked. */
function unchangedDecision(version: string): PublishDecision {
	return { action: 'skip', reason: `version unchanged (${version})` }
}

/** The refusal of a version not above npm's dist-tag, or undefined; a dist-tag npm lacks sets no floor. */
function floorRefusal(params: {
	current: SemVer
	currentVersion: string
	floor: DistTag
	floorVersion: string | undefined
}): string | undefined {
	const { current, currentVersion, floor, floorVersion } = params
	if (floorVersion === undefined) return undefined
	const parsed = parseSemVer(floorVersion)
	if (parsed === undefined) return `npm's ${floor} ${floorVersion} is not a semver version`
	return compareSemVer(current, parsed) > 0
		? undefined
		: `${currentVersion} is not above npm's ${floor} ${floorVersion}`
}

/** The release tag of a package version: `<name without scope>@v<version>`, as `_tag-release.yml` names it. */
function releaseTagOf(packageJson: { name: string; version: string }): string {
	return `${packageJson.name.replace(/.*\//, '')}@v${packageJson.version}`
}

/** Whether origin has the release tag. */
function tagOnOrigin(params: { io: PublishDecisionIo; tag: string }): 'found' | 'missing' {
	return lsRemoteState(
		params.io.run({
			command: 'git',
			args: ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${params.tag}`],
		}),
	)
}

/** The command's stdout, or an error naming the command and its stderr. */
function stdoutOf(params: {
	io: PublishDecisionIo
	command: string
	args: readonly string[]
}): string {
	const result = params.io.run({ command: params.command, args: params.args })
	if (result.exitCode !== 0) {
		throw new Error(
			`${params.command} ${params.args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`,
		)
	}
	return result.stdout
}

/** The name and version of a package.json text. */
function readPackage(text: string): { name: string; version: string } {
	const parsed = parseJson(text)
	if (!isRecord(parsed) || typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
		throw new Error('package.json lacks a name or a version')
	}
	return { name: parsed.name, version: parsed.version }
}

/** The parts of a semver version, or undefined when it is not one (leading zeros included). */
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
function npmErrorReason(result: CommandResult): string {
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
