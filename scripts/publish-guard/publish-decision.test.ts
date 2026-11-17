import {
	decidePublish,
	lsRemoteState,
	outputsOf,
	readNpmView,
	runPublishDecision,
} from './publish-decision.ts'

import { describe, expect, it } from 'vitest'

import type {
	CommandResult,
	PublishDecision,
	PublishDecisionIo,
	PublishFacts,
	RegistryState,
} from './publish-decision.types.ts'

/** npm with a latest release and the versions it holds. */
function npmHas(params: { latest: string; versions: string[] }): RegistryState {
	return { kind: 'present', distTags: { latest: params.latest }, versions: params.versions }
}

/** The action, its dist-tag when it publishes, and whether it says why. */
function summarizeDecision(decision: PublishDecision): {
	action: string
	distTag?: string
	reason: boolean
} {
	return {
		action: decision.action,
		distTag: decision.action === 'publish' ? decision.distTag : undefined,
		reason: decision.reason.length > 0,
	}
}

describe('decidePublish', () => {
	it.each<{ name: string; facts: PublishFacts; action: string; distTag?: string }>([
		{
			name: '0.7.0 to 0.8.0, latest 0.7.0 → publish under latest',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: '0.7.0', versions: ['0.6.0', '0.7.0'] }),
				tagExists: false,
			},
			action: 'publish',
			distTag: 'latest',
		},
		{
			name: 'a first publish (npm E404) → publish',
			facts: {
				previousVersion: '0.0.0',
				currentVersion: '0.1.0',
				registry: { kind: 'absent' },
				tagExists: false,
			},
			action: 'publish',
			distTag: 'latest',
		},
		{
			name: '0.8.0 to 0.7.1, latest 0.8.0 → refused',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.7.1',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'typo 0.0.8, latest 0.8.0 → refused',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.0.8',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'revert to a published version → skipped',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.7.0',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: true,
			},
			action: 'skip',
		},
		{
			name: 'an unchanged version → skipped',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: true,
			},
			action: 'skip',
		},
		{
			name: 'a pre-release → publish under next',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.9.0-rc.1',
				registry: npmHas({ latest: '0.8.0', versions: ['0.8.0'] }),
				tagExists: false,
			},
			action: 'publish',
			distTag: 'next',
		},
		{
			name: 'npm has the version, its tag missing → tag only, no publish',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: false,
			},
			action: 'tag',
		},
	])('$name', ({ facts, action, distTag }) => {
		expect(summarizeDecision(decidePublish(facts))).toEqual({ action, distTag, reason: true })
	})
})

describe('readNpmView', () => {
	it.each<{
		name: string
		exitCode: number
		stdout: string
		stderr: string
		registry: RegistryState
	}>([
		{
			name: 'npm view exits 0 → its dist-tags and versions read',
			exitCode: 0,
			stdout: JSON.stringify({ 'dist-tags': { latest: '0.8.0' }, versions: ['0.7.0', '0.8.0'] }),
			stderr: '',
			registry: { kind: 'present', distTags: { latest: '0.8.0' }, versions: ['0.7.0', '0.8.0'] },
		},
		{
			name: 'npm view fails with code E404 → the package is absent',
			exitCode: 1,
			stdout: JSON.stringify({
				error: { code: 'E404', summary: 'Not Found - GET https://registry.npmjs.org/x' },
			}),
			stderr: 'npm error code E404',
			registry: { kind: 'absent' },
		},
		{
			name: "npm view fails otherwise → refused with npm's reason",
			exitCode: 1,
			stdout: JSON.stringify({
				error: { code: 'ETIMEDOUT', summary: 'request to https://registry.npmjs.org/x failed' },
			}),
			stderr: 'npm error code ETIMEDOUT',
			registry: {
				kind: 'failed',
				reason: 'ETIMEDOUT: request to https://registry.npmjs.org/x failed',
			},
		},
	])('$name', ({ exitCode, stdout, stderr, registry }) => {
		expect(readNpmView({ exitCode, stdout, stderr })).toEqual(registry)
	})
})

describe('decidePublish, the edges', () => {
	it.each<{ name: string; facts: PublishFacts; action: string; distTag?: string }>([
		{
			name: '0.8.0-rc.1 below latest 0.8.0 → refused',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0-rc.1',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'rc.10 over next rc.9 → publish under next',
			facts: {
				previousVersion: '1.0.0-rc.9',
				currentVersion: '1.0.0-rc.10',
				registry: {
					kind: 'present',
					distTags: { latest: '0.9.0', next: '1.0.0-rc.9' },
					versions: ['0.9.0', '1.0.0-rc.9'],
				},
				tagExists: false,
			},
			action: 'publish',
			distTag: 'next',
		},
		{
			name: '1.0.0 over next 1.0.0-rc.9 → publish under latest',
			facts: {
				previousVersion: '1.0.0-rc.9',
				currentVersion: '1.0.0',
				registry: {
					kind: 'present',
					distTags: { latest: '0.9.0', next: '1.0.0-rc.9' },
					versions: ['0.9.0', '1.0.0-rc.9'],
				},
				tagExists: false,
			},
			action: 'publish',
			distTag: 'latest',
		},
		{
			name: "a pre-release below npm's next → refused",
			facts: {
				previousVersion: '0.9.0',
				currentVersion: '1.0.0-rc.2',
				registry: {
					kind: 'present',
					distTags: { latest: '0.9.0', next: '1.0.0-rc.3' },
					versions: ['0.9.0', '1.0.0-rc.3'],
				},
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'npm has the version and its tag exists → skipped',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: true,
			},
			action: 'skip',
		},
		{
			name: 'revert to a published version, its tag missing → tag only, no publish',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.7.0',
				registry: npmHas({ latest: '0.8.0', versions: ['0.7.0', '0.8.0'] }),
				tagExists: false,
			},
			action: 'tag',
		},
		{
			name: 'the release tag exists, npm lacks the version → refused',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: '0.7.0', versions: ['0.7.0'] }),
				tagExists: true,
			},
			action: 'refuse',
		},
		{
			name: 'a failed npm query → refused',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: { kind: 'failed', reason: 'ETIMEDOUT: request failed' },
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'an unchanged version with a failed npm query → skipped',
			facts: {
				previousVersion: '0.8.0',
				currentVersion: '0.8.0',
				registry: { kind: 'failed', reason: 'ETIMEDOUT: request failed' },
				tagExists: false,
			},
			action: 'skip',
		},
		{
			name: 'not semver: 01.0.0 → refused',
			facts: {
				previousVersion: '0.9.0',
				currentVersion: '01.0.0',
				registry: npmHas({ latest: '0.9.0', versions: ['0.9.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'not semver: 0.8 → refused',
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8',
				registry: npmHas({ latest: '0.7.0', versions: ['0.7.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
		{
			name: 'npm has no latest → publish',
			facts: {
				previousVersion: '0.0.0',
				currentVersion: '0.1.0',
				registry: { kind: 'present', distTags: {}, versions: [] },
				tagExists: false,
			},
			action: 'publish',
			distTag: 'latest',
		},
		{
			name: "npm's latest unreadable → refused",
			facts: {
				previousVersion: '0.7.0',
				currentVersion: '0.8.0',
				registry: npmHas({ latest: 'garbage', versions: ['0.7.0'] }),
				tagExists: false,
			},
			action: 'refuse',
		},
	])('$name', ({ facts, action, distTag }) => {
		expect(summarizeDecision(decidePublish(facts))).toEqual({ action, distTag, reason: true })
	})
})

describe('readNpmView, the edges', () => {
	it.each<{ name: string; result: CommandResult; registry: RegistryState }>([
		{
			name: 'exit 0 with an empty stdout → the package is absent',
			result: { exitCode: 0, stdout: '', stderr: '' },
			registry: { kind: 'absent' },
		},
		{
			name: 'exit 0 with unreadable JSON → failed',
			result: { exitCode: 0, stdout: 'not json', stderr: '' },
			registry: { kind: 'failed', reason: 'unreadable npm view output: not json' },
		},
		{
			name: 'versions as one string → a list of that version',
			result: {
				exitCode: 0,
				stdout: JSON.stringify({ 'dist-tags': { latest: '0.1.0' }, versions: '0.1.0' }),
				stderr: '',
			},
			registry: { kind: 'present', distTags: { latest: '0.1.0' }, versions: ['0.1.0'] },
		},
	])('$name', ({ result, registry }) => {
		expect(readNpmView(result)).toEqual(registry)
	})
})

describe('lsRemoteState', () => {
	it.each([
		{ name: 'exit 0 → found', exitCode: 0, state: 'found' },
		{ name: 'exit 2 → missing', exitCode: 2, state: 'missing' },
	])('$name', ({ exitCode, state }) => {
		expect(lsRemoteState({ exitCode, stderr: '' })).toBe(state)
	})

	it("any other exit → throws with git's reason", () => {
		expect(() => lsRemoteState({ exitCode: 128, stderr: 'fatal: no remote' })).toThrow(
			'fatal: no remote',
		)
	})
})

describe('outputsOf', () => {
	it.each<{ name: string; decision: PublishDecision; outputs: string }>([
		{
			name: 'publish → publish, dist_tag and tag',
			decision: { action: 'publish', distTag: 'next', reason: 'r' },
			outputs: 'publish=true\ndist_tag=next\ntag=true\n',
		},
		{
			name: 'tag only → tag, no dist_tag',
			decision: { action: 'tag', reason: 'r' },
			outputs: 'publish=false\ntag=true\n',
		},
		{
			name: 'skip → neither, no dist_tag',
			decision: { action: 'skip', reason: 'r' },
			outputs: 'publish=false\ntag=false\n',
		},
	])('$name', ({ decision, outputs }) => {
		expect(outputsOf(decision)).toBe(outputs)
	})
})

/** A package.json text of the test package at a version. */
function packageOf(version: string): string {
	return JSON.stringify({ name: '@scope/pkg', version })
}

/** What a push to main sees: package.json now and before, npm and the tag lookup, answered by command line. */
function pushOf(params: {
	before?: string
	current: string
	previous: string
	npm?: CommandResult
	tagExit?: number
}): { io: PublishDecisionIo; outputs: string[]; commands: string[] } {
	const outputs: string[] = []
	const commands: string[] = []
	const answers: Record<string, CommandResult> = {
		[`git show ${params.before ?? 'abc'}:package.json`]: {
			exitCode: 0,
			stdout: packageOf(params.previous),
			stderr: '',
		},
		'npm view @scope/pkg dist-tags versions --json': params.npm ?? {
			exitCode: 1,
			stdout: '',
			stderr: 'npm view must not run',
		},
		[`git ls-remote --exit-code --tags origin refs/tags/pkg@v${params.current}`]: {
			exitCode: params.tagExit ?? 2,
			stdout: '',
			stderr: '',
		},
	}
	const environment: Record<string, string> =
		params.before === ''
			? { GITHUB_OUTPUT: 'out' }
			: { BEFORE: params.before ?? 'abc', GITHUB_OUTPUT: 'out' }
	return {
		outputs,
		commands,
		io: {
			environment,
			readFile: () => packageOf(params.current),
			run: ({ command, args }) => {
				const line = [command, ...args].join(' ')
				commands.push(line)
				return answers[line] ?? { exitCode: 1, stdout: '', stderr: `unexpected ${line}` }
			},
			appendOutput: ({ text }) => {
				outputs.push(text)
			},
			print: () => undefined,
		},
	}
}

describe('runPublishDecision', () => {
	it('a version-changing push npm lacks → exit 0, publish outputs written', () => {
		const push = pushOf({
			current: '0.8.0',
			previous: '0.7.0',
			npm: {
				exitCode: 0,
				stdout: JSON.stringify({ 'dist-tags': { latest: '0.7.0' }, versions: ['0.7.0'] }),
				stderr: '',
			},
		})

		expect({ exitCode: runPublishDecision(push.io), outputs: push.outputs }).toEqual({
			exitCode: 0,
			outputs: ['publish=true\ndist_tag=latest\ntag=true\n'],
		})
	})

	it('an unchanged version → npm never asked, nothing to publish or tag', () => {
		const push = pushOf({ current: '0.8.0', previous: '0.8.0' })

		expect({
			exitCode: runPublishDecision(push.io),
			outputs: push.outputs,
			askedNpm: push.commands.some((line) => line.startsWith('npm ')),
		}).toEqual({ exitCode: 0, outputs: ['publish=false\ntag=false\n'], askedNpm: false })
	})

	it('a refusal → exit 1, no outputs written', () => {
		const push = pushOf({
			current: '0.7.1',
			previous: '0.8.0',
			npm: {
				exitCode: 0,
				stdout: JSON.stringify({ 'dist-tags': { latest: '0.8.0' }, versions: ['0.8.0'] }),
				stderr: '',
			},
		})

		expect({ exitCode: runPublishDecision(push.io), outputs: push.outputs }).toEqual({
			exitCode: 1,
			outputs: [],
		})
	})

	it('BEFORE missing → throws', () => {
		expect(() =>
			runPublishDecision(pushOf({ before: '', current: '0.8.0', previous: '0.7.0' }).io),
		).toThrow('BEFORE')
	})
})
