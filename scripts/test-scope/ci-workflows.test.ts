import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKAGE_ROOT } from './test-scope.constants'

import { describe, expect, it } from 'vitest'

const WORKFLOWS_FOLDER = join(PACKAGE_ROOT, '.github/workflows')

/** A file's text under the package root; empty when the file does not exist (the case then fails on its assertion). */
function packageText(params: { path: string }): string {
	const path = join(PACKAGE_ROOT, params.path)
	return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** A workflow's text, from the package's workflows folder; empty when there is no such workflow. */
function workflowText(params: { name: string }): string {
	return packageText({ path: join('.github/workflows', params.name) })
}

/** The block of one top-level job of a workflow: from its `  <name>:` line to the next job or the end. */
function jobBlock(params: { name: string; job: string }): string {
	const text = workflowText({ name: params.name })
	const start = text.indexOf(`\n  ${params.job}:\n`)
	if (start < 0) return ''
	const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/)
	return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

/** The names of a workflow's top-level jobs, in order. */
function jobNames(params: { name: string }): string[] {
	const jobs = workflowText({ name: params.name }).split('\njobs:\n')[1] ?? ''
	return [...jobs.matchAll(/^ {2}([a-z][\w-]*):$/gm)].map((match) => match[1])
}

/** The shard argument every browser run of the test workflow passes: its matrix shard over the matrix size. */
const SHARD_ARGUMENT = '--shard=${{ matrix.shard }}/${{ strategy.job-total }}'

/** The jobs of ci.yml that check a pull request or a queue entry: the ones ci-ok answers for. */
const CHECK_JOBS = ['build', 'check', 'type-perf', 'docs', 'test']

/** The jobs of publish.yml: a push to main builds, reads the version, publishes and tags - it tests nothing. */
const PUBLISH_JOBS = [
	'install',
	'build',
	'version',
	'extract-version',
	'deploy',
	'create-release-tag',
]

/** The trigger block of a workflow: the lines under `on:` up to the first blank line, each line ending in a newline. */
function triggerBlock(params: { name: string }): string {
	const on = workflowText({ name: params.name }).split('\non:\n')[1]?.split('\n\n')[0]
	return on === undefined ? '' : `${on}\n`
}

describe('the ci workflow', () => {
	/** Each event ci.yml answers, with the lines its trigger holds (a branch filter where there is one). */
	const TRIGGERS: Record<string, string> = {
		'a manual run': '  workflow_dispatch:\n',
		'a pull request to main': '  pull_request:\n    branches:\n      - main\n',
		'the merge queue': '  merge_group:\n',
	}

	for (const [event, trigger] of Object.entries(TRIGGERS)) {
		it(`ci checks every change before main: ${event}`, () => {
			expect(triggerBlock({ name: 'ci.yml' })).toContain(trigger)
		})
	}

	it('ci never runs on a push to main (publish.yml does, the queue tested that tree)', () => {
		expect(triggerBlock({ name: 'ci.yml' })).not.toMatch(/^ {2}push:/m)
	})

	it('the retired workflows are gone', () => {
		expect(
			['pr.yml', '_lint.yml'].filter((name) => existsSync(join(WORKFLOWS_FOLDER, name))),
		).toEqual([])
	})

	it('a new push of a pull request cancels the run it supersedes; queue runs always finish', () => {
		expect(workflowText({ name: 'ci.yml' })).toContain(
			"concurrency:\n  group: ci-${{ github.event_name }}-${{ github.ref }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
		)
	})

	it('every job of ci is install, a check or ci-ok, none conditional on the event', () => {
		expect(jobNames({ name: 'ci.yml' }).sort()).toEqual(['install', ...CHECK_JOBS, 'ci-ok'].sort())
		for (const job of ['install', ...CHECK_JOBS])
			expect(jobBlock({ name: 'ci.yml', job }), job).not.toMatch(/\n {4}if:/)
	})

	it('ci-ok runs whatever the checks gave and needs every check', () => {
		const ciOk = jobBlock({ name: 'ci.yml', job: 'ci-ok' })
		expect(ciOk).toContain('\n    if: always()\n')
		expect(ciOk).toContain(`\n    needs:\n${CHECK_JOBS.map((job) => `      - ${job}\n`).join('')}`)
	})

	it('ci-ok is green only when every check succeeded (a skipped or cancelled check fails it)', () => {
		const ciOk = jobBlock({ name: 'ci.yml', job: 'ci-ok' })
		for (const job of CHECK_JOBS)
			expect(ciOk, job).toContain(`\n          test "\${{ needs.${job}.result }}" = success\n`)
	})

	it('a pull request runs the browser tests its change selects, a queue entry or a manual run the whole suite', () => {
		expect(jobBlock({ name: 'ci.yml', job: 'test' })).toMatch(
			/uses: \.\/\.github\/workflows\/_test\.yml\n {4}with:\n {6}mode: \$\{\{ github\.event_name == 'pull_request' && 'pr' \|\| 'full' \}\}\n/,
		)
	})

	it('the docs build is a check, run by the docs workflow', () => {
		expect(jobBlock({ name: 'ci.yml', job: 'docs' })).toContain(
			'uses: ./.github/workflows/_docs.yml',
		)
		expect(workflowText({ name: '_docs.yml' })).toContain('run: npm run doc:build\n')
	})
})

describe('the publish workflow', () => {
	it('runs on a push to main only', () => {
		expect(triggerBlock({ name: 'publish.yml' })).toBe('  push:\n    branches:\n      - main\n')
	})

	it('builds, reads the version, publishes and tags: no test, no check', () => {
		expect(jobNames({ name: 'publish.yml' }).sort()).toEqual([...PUBLISH_JOBS].sort())
	})

	it('every push to main runs to its end: no concurrency group replaces a pending run', () => {
		expect(workflowText({ name: 'publish.yml' })).not.toContain('concurrency:')
	})

	it('publishes only when the version check says publish, under the dist-tag it gives', () => {
		const deploy = jobBlock({ name: 'publish.yml', job: 'deploy' })
		expect(deploy).toContain("\n    if: needs.version.outputs.publish == 'true'\n")
		expect(deploy).toContain('\n    with:\n      dist-tag: ${{ needs.version.outputs.dist_tag }}\n')
	})

	it('tags after the publish, or alone when npm has the version and its tag is missing; never after a failure', () => {
		expect(jobBlock({ name: 'publish.yml', job: 'create-release-tag' })).toContain(
			"\n    if: ${{ !cancelled() && !failure() && needs.version.outputs.tag == 'true' }}\n",
		)
	})

	it('_publish.yml publishes under the dist-tag it is given, passed through env, with id-token write', () => {
		const publish = workflowText({ name: '_publish.yml' })
		expect(publish).toContain('\n      id-token: write\n')
		expect(publish).toContain('\n      dist-tag:\n        required: true\n        type: string\n')
		expect(publish).toContain(
			'\n        env:\n          DIST_TAG: ${{ inputs.dist-tag }}\n        run: npm publish --access public --tag "$DIST_TAG"\n',
		)
	})

	for (const name of ['_publish.yml', '_tag-release.yml']) {
		it(`${name} is called by publish.yml only: no workflow_dispatch, which skips the guard`, () => {
			expect(triggerBlock({ name })).not.toContain('workflow_dispatch')
		})
	}

	it('_check-npm-version.yml runs the decision script and hides no error', () => {
		const check = workflowText({ name: '_check-npm-version.yml' })
		expect(check).toContain('node scripts/publish-guard/run-publish-decision.ts\n')
		expect(check).not.toContain('2>/dev/null')
	})

	it('the tag waits for the publish: no tag without a published version', () => {
		expect(jobBlock({ name: 'publish.yml', job: 'create-release-tag' })).toContain(
			'\n    needs:\n      - version\n      - extract-version\n      - deploy\n',
		)
	})

	it('the publish waits for the build and the version check', () => {
		expect(jobBlock({ name: 'publish.yml', job: 'deploy' })).toContain(
			'\n    needs:\n      - build\n      - version\n',
		)
	})
})

describe('the CI test workflows', () => {
	it('the test workflow runs the node tiers in a job of their own', () => {
		// the `node` job holds the node tiers, the `browser` job (the shards) comes after it
		expect(workflowText({ name: '_test.yml' })).toMatch(
			/\n {2}node:\n(?: {4}[^\n]*\n|\n)*? {8}run: npm run test:node\n[\s\S]*\n {2}browser:\n/,
		)
	})

	it('in mode pr, the browser runs the selection against the pull request base, sharded', () => {
		expect(workflowText({ name: '_test.yml' })).toContain(
			`if: inputs.mode == 'pr'\n        run: npm run test:scope -- --base origin/\${{ github.base_ref }} ${SHARD_ARGUMENT}`,
		)
	})

	it('in mode full, the browser runs the whole suite with the full table, sharded', () => {
		expect(workflowText({ name: '_test.yml' })).toContain(
			`if: inputs.mode == 'full'\n        run: npm run test:browser:release -- ${SHARD_ARGUMENT}`,
		)
	})

	it('the browser job is a shard matrix that keeps going when one shard fails', () => {
		expect(workflowText({ name: '_test.yml' })).toMatch(
			/strategy:\s+fail-fast: false\s+matrix:\s+shard: \[1, 2, 3, 4\]/,
		)
	})

	it('the checkout holds the history the selection compares with (the merge base with the pull request base)', () => {
		expect(workflowText({ name: '_test.yml' })).toMatch(
			/uses: actions\/checkout@v\d+\s+with:\s+fetch-depth: 0/,
		)
	})

	it('no CI run is left on the whole browser suite without the full table', () => {
		expect(workflowText({ name: '_test.yml' })).not.toMatch(/test:browser:all/)
	})
})

describe('the Node version', () => {
	it('the package names it once, in .nvmrc', () => {
		expect(packageText({ path: '.nvmrc' })).toMatch(/^\d+\n$/)
	})

	it('every workflow that sets up Node reads .nvmrc, none names a version', () => {
		const workflows = readdirSync(WORKFLOWS_FOLDER).filter((name) => name.endsWith('.yml'))
		// every setup step with what follows it up to the next step: a bare one (no `with:`) counts as not reading .nvmrc
		const setups = workflows.flatMap((name) =>
			workflowText({ name })
				.split(/\n(?= {6}- )/)
				.filter((step) => /uses: actions\/setup-node@/.test(step))
				.map((step) => ({ name, step })),
		)
		expect(setups.length).toBeGreaterThan(0)
		expect(setups.filter((setup) => !setup.step.includes("node-version-file: '.nvmrc'"))).toEqual(
			[],
		)
		expect(workflows.filter((name) => /node-version:/.test(workflowText({ name })))).toEqual([])
	})
})
