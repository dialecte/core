import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { changesSinceBase } from './changes-since-base'

import { afterEach, describe, expect, it } from 'vitest'

/**
 * How long one case may take: it builds a repository with a dozen git runs, each a process; a few hundred ms at rest,
 * past the 5 s default on a loaded machine.
 */
const GIT_FIXTURE_CASE_TIMEOUT_MS = 30_000

/** The environment of the fixture's git runs: a commit hook's GIT_* variables left out. */
function fixtureGitEnvironment(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
	)
}

function git(params: { root: string; args: string[] }): string {
	return execFileSync('git', params.args, {
		cwd: params.root,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
		env: fixtureGitEnvironment(),
	}).trim()
}

/**
 * A repository whose default branch is `trunk` (no `main`), a base commit, `refs/remotes/origin/main` on it, and a
 * branch `feature` with one commit: a CI checkout or a fresh clone, as the tool meets them.
 */
function makeCheckout(params: { withOriginMain: boolean }): string {
	const root = mkdtempSync(join(tmpdir(), 'test-scope-base-'))
	git({ root, args: ['init', '-q', '-b', 'trunk'] })
	git({ root, args: ['config', 'user.email', 'test@example.com'] })
	git({ root, args: ['config', 'user.name', 'test'] })
	git({ root, args: ['config', 'commit.gpgsign', 'false'] })
	mkdirSync(join(root, 'src'))
	writeFileSync(join(root, 'src/kept.ts'), 'export const kept = 1')
	git({ root, args: ['add', '.'] })
	git({ root, args: ['commit', '-q', '--no-verify', '-m', 'base'] })
	if (params.withOriginMain) {
		git({
			root,
			args: ['update-ref', 'refs/remotes/origin/main', git({ root, args: ['rev-parse', 'HEAD'] })],
		})
	}
	git({ root, args: ['checkout', '-q', '-b', 'feature'] })
	writeFileSync(join(root, 'src/committed.ts'), 'export const committed = 1')
	git({ root, args: ['add', '.'] })
	git({ root, args: ['commit', '-q', '--no-verify', '-m', 'feature'] })
	return root
}

describe('changesSinceBase', { timeout: GIT_FIXTURE_CASE_TIMEOUT_MS }, () => {
	let roots: string[] = []

	afterEach(() => {
		for (const root of roots) rmSync(root, { recursive: true, force: true })
		roots = []
	})

	function checkout(params: { withOriginMain: boolean }): string {
		const root = makeCheckout(params)
		roots.push(root)
		return root
	}

	it('the default base missing, origin/main there: the changes since origin/main, that base named', () => {
		const root = checkout({ withOriginMain: true })
		expect(changesSinceBase({ root, base: 'main' })).toEqual({
			base: 'origin/main',
			changes: { kind: 'files', files: ['src/committed.ts'] },
		})
	})

	it('the default base there: it is used, no fallback', () => {
		const root = checkout({ withOriginMain: true })
		git({ root, args: ['branch', 'main', 'trunk'] })
		writeFileSync(join(root, 'src/edited.ts'), 'export const edited = 1')
		expect(changesSinceBase({ root, base: 'main' })).toEqual({
			base: 'main',
			changes: { kind: 'files', files: ['src/committed.ts', 'src/edited.ts'] },
		})
	})

	it('neither the default base nor origin/main: unknown, naming both', () => {
		const root = checkout({ withOriginMain: false })
		expect(changesSinceBase({ root, base: 'main' })).toEqual({
			base: 'main',
			changes: {
				kind: 'unknown',
				// `main` on its own, then `origin/main`: each base tried is named
				reason: expect.stringMatching(/(?<!origin\/)\bmain\b[\s\S]*origin\/main/),
			},
		})
	})

	it('a base named on purpose is read as given: no fallback when it does not resolve', () => {
		const root = checkout({ withOriginMain: true })
		expect(changesSinceBase({ root, base: 'release/1.0' })).toEqual({
			base: 'release/1.0',
			changes: { kind: 'unknown', reason: expect.stringMatching(/release\/1\.0/) },
		})
	})
})
