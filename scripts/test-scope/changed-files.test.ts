import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { changedFilesSince } from './changed-files'

import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * How long one case may take: it builds a repository with a dozen git runs, each a process; a few hundred ms at rest,
 * past the 5 s default on a loaded machine.
 */
const GIT_FIXTURE_CASE_TIMEOUT_MS = 30_000

/**
 * The environment of the fixture's git runs: a commit hook exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE, which
 * would point every git command at the repository being committed instead of the fixture's.
 */
function fixtureGitEnvironment(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
	)
}

function git(params: { root: string; args: string[] }): void {
	execFileSync('git', params.args, {
		cwd: params.root,
		stdio: 'ignore',
		env: fixtureGitEnvironment(),
	})
}

/** A repository under a temporary folder: `main` with three files, then a branch `feature` with its own commit. */
function makeRepository(): string {
	const root = mkdtempSync(join(tmpdir(), 'test-scope-git-'))
	git({ root, args: ['init', '-q', '-b', 'main'] })
	git({ root, args: ['config', 'user.email', 'test@example.com'] })
	git({ root, args: ['config', 'user.name', 'test'] })
	git({ root, args: ['config', 'commit.gpgsign', 'false'] })
	mkdirSync(join(root, 'src'))
	writeFileSync(join(root, 'src/kept.ts'), 'export const kept = 1')
	writeFileSync(join(root, 'src/edited.ts'), 'export const edited = 1')
	writeFileSync(join(root, 'src/deleted.ts'), 'export const deleted = 1')
	writeFileSync(join(root, 'src/renamed.ts'), 'export const renamed = 1')
	writeFileSync(join(root, '.gitignore'), 'ignored.ts\n')
	git({ root, args: ['add', '.'] })
	git({ root, args: ['commit', '-q', '--no-verify', '-m', 'base'] })
	git({ root, args: ['checkout', '-q', '-b', 'feature'] })
	writeFileSync(join(root, 'src/committed.ts'), 'export const committed = 1')
	git({ root, args: ['add', 'src/committed.ts'] })
	git({ root, args: ['commit', '-q', '--no-verify', '-m', 'feature'] })
	return root
}

describe('changedFilesSince', { timeout: GIT_FIXTURE_CASE_TIMEOUT_MS }, () => {
	let roots: string[] = []

	afterEach(() => {
		vi.unstubAllEnvs()
		for (const root of roots) rmSync(root, { recursive: true, force: true })
		roots = []
	})

	function repository(): string {
		const root = makeRepository()
		roots.push(root)
		return root
	}

	it('every kind of change since the merge base, each file once, sorted; ignored and untouched files left out', () => {
		const root = repository()
		// edited again after its commit on the branch: listed once
		writeFileSync(join(root, 'src/committed.ts'), 'export const committed = 2')
		// staged only
		writeFileSync(join(root, 'src/staged.ts'), 'export const staged = 1')
		git({ root, args: ['add', 'src/staged.ts'] })
		writeFileSync(join(root, 'src/edited.ts'), 'export const edited = 2')
		unlinkSync(join(root, 'src/deleted.ts'))
		renameSync(join(root, 'src/renamed.ts'), join(root, 'src/renamed-to.ts'))
		git({ root, args: ['add', '-A', 'src/renamed.ts', 'src/renamed-to.ts'] })
		// untracked, sorting before every other change
		writeFileSync(join(root, 'src/a-untracked.ts'), 'export const untracked = 1')
		// untracked in a new folder: the file, not the folder
		mkdirSync(join(root, 'src/new-folder'))
		writeFileSync(join(root, 'src/new-folder/nested.ts'), 'export const nested = 1')
		writeFileSync(join(root, 'ignored.ts'), '')
		expect(changedFilesSince({ root, base: 'main' })).toEqual({
			kind: 'files',
			files: [
				'src/a-untracked.ts',
				'src/committed.ts',
				'src/deleted.ts',
				'src/edited.ts',
				'src/new-folder/nested.ts',
				'src/renamed-to.ts',
				'src/renamed.ts',
				'src/staged.ts',
			],
		})
	})

	it('a commit on the base after the branch was cut is not a change of the lot (the merge base is the reference)', () => {
		const root = repository()
		git({ root, args: ['checkout', '-q', 'main'] })
		writeFileSync(join(root, 'src/on-main.ts'), 'export const onMain = 1')
		git({ root, args: ['add', '.'] })
		git({ root, args: ['commit', '-q', '--no-verify', '-m', 'main moved'] })
		git({ root, args: ['checkout', '-q', 'feature'] })
		expect(changedFilesSince({ root, base: 'main' })).toEqual({
			kind: 'files',
			files: ['src/committed.ts'],
		})
	})

	it('nothing changed: an empty list', () => {
		const root = repository()
		expect(changedFilesSince({ root, base: 'feature' })).toEqual({ kind: 'files', files: [] })
	})

	it("another repository's GIT_DIR and GIT_INDEX_FILE in the environment (a commit hook's): the repository at root is read", () => {
		const root = repository()
		const other = repository()
		// the other repository's index holds a change of its own: read through its GIT_INDEX_FILE, it would show
		writeFileSync(join(other, 'src/only-in-other.ts'), 'export const other = 1')
		git({ root: other, args: ['add', 'src/only-in-other.ts'] })
		vi.stubEnv('GIT_DIR', join(other, '.git'))
		vi.stubEnv('GIT_INDEX_FILE', join(other, '.git/index'))
		vi.stubEnv('GIT_WORK_TREE', other)
		writeFileSync(join(root, 'src/edited.ts'), 'export const edited = 2')
		expect(changedFilesSince({ root, base: 'main' })).toEqual({
			kind: 'files',
			files: ['src/committed.ts', 'src/edited.ts'],
		})
	})

	it('a base git cannot resolve: unknown, naming the base', () => {
		const root = repository()
		expect(changedFilesSince({ root, base: 'no-such-ref' })).toEqual({
			kind: 'unknown',
			reason: expect.stringMatching(/no-such-ref/),
		})
	})

	it('a base sharing no history with HEAD: unknown, naming the base', () => {
		const root = repository()
		git({ root, args: ['checkout', '-q', '--orphan', 'unrelated'] })
		git({ root, args: ['commit', '-q', '--no-verify', '-m', 'unrelated'] })
		git({ root, args: ['checkout', '-q', 'feature'] })
		expect(changedFilesSince({ root, base: 'unrelated' })).toEqual({
			kind: 'unknown',
			reason: expect.stringMatching(/unrelated/),
		})
	})
})
