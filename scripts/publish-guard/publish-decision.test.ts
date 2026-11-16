import { decidePublish, readNpmView } from './publish-decision.ts'

import { describe, expect, it } from 'vitest'

import type { PublishDecision, PublishFacts, RegistryState } from './publish-decision.types.ts'

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
