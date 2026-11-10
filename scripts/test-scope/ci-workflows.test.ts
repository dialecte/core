import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKAGE_ROOT } from './test-scope.constants'

import { describe, expect, it } from 'vitest'

/** A workflow's text, from the package's workflows folder. */
function workflowText(params: { name: string }): string {
	return readFileSync(join(PACKAGE_ROOT, '.github/workflows', params.name), 'utf8')
}

/** The shard argument every browser run of the test workflow passes: its matrix shard over the matrix size. */
const SHARD_ARGUMENT = '--shard=${{ matrix.shard }}/${{ strategy.job-total }}'

type CallCase = {
	workflow: string
	mode: string
}

const CALLS: Record<string, CallCase> = {
	'a pull request runs the browser tests its change selects': { workflow: 'pr.yml', mode: 'pr' },
	'a push to main (the publish path) runs the whole suite with the full table': {
		workflow: 'publish.yml',
		mode: 'release',
	},
}

describe('the CI test workflows', () => {
	for (const [name, call] of Object.entries(CALLS)) {
		it(`${name}: it calls the test workflow with mode ${call.mode}`, () => {
			expect(workflowText({ name: call.workflow })).toMatch(
				new RegExp(`uses: \\./\\.github/workflows/_test\\.yml\\s+with:\\s+mode: ${call.mode}\\b`),
			)
		})
	}

	it('the test workflow runs the node tiers in a job of their own', () => {
		// the `node` job holds the node tiers, the `browser` job (the shards) comes after it
		expect(workflowText({ name: '_test.yml' })).toMatch(
			/\n {2}node:\n(?: {4}[^\n]*\n|\n)*? {8}run: npm run test:node\n[\s\S]*\n {2}browser:\n/,
		)
	})

	it('in mode pr, the browser runs the selection against the pull request base, sharded', () => {
		expect(workflowText({ name: '_test.yml' })).toContain(
			`run: npm run test:scope -- --base origin/\${{ github.base_ref }} ${SHARD_ARGUMENT}`,
		)
	})

	it('in mode release, the browser runs the whole suite with the full table, sharded', () => {
		expect(workflowText({ name: '_test.yml' })).toContain(
			`run: npm run test:browser:release -- ${SHARD_ARGUMENT}`,
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
