import { execFileSync } from 'node:child_process'

import { GIT_HOOK_VARIABLES } from './test-scope.constants'

import type { ScopeChanges } from './test-scope.types'

/** The environment of a git run reading `root`: the variables a hook exports left out. */
function gitEnvironment(): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !GIT_HOOK_VARIABLES.includes(name)),
	)
}

/** A git command's output lines, run in `root`. */
function gitLines(params: { root: string; args: string[] }): string[] {
	return execFileSync('git', params.args, {
		cwd: params.root,
		encoding: 'utf8',
		env: gitEnvironment(),
		stdio: ['ignore', 'pipe', 'pipe'],
	})
		.split('\n')
		.filter((line) => line.length > 0)
}

/** The merge base of `base` and HEAD, or none (a ref git does not know, a history HEAD does not share). */
function mergeBaseOf(params: { root: string; base: string }): string | undefined {
	try {
		return gitLines({ root: params.root, args: ['merge-base', params.base, 'HEAD'] })[0]
	} catch {
		return undefined
	}
}

/**
 * The files changed since the merge base of `base` and HEAD, from the package root: committed, uncommitted and untracked
 * (ignored files left out), deleted ones included. A base git cannot resolve gives `unknown`, with why.
 */
export function changedFilesSince(params: { root: string; base: string }): ScopeChanges {
	const { root, base } = params
	const mergeBase = mergeBaseOf({ root, base })
	if (mergeBase === undefined) {
		return {
			kind: 'unknown',
			reason: `the base ${base} is not a ref sharing history with HEAD in this repository`,
		}
	}
	const changed = gitLines({
		root,
		args: ['diff', '--name-only', '--no-renames', '--relative', mergeBase],
	})
	const untracked = gitLines({ root, args: ['ls-files', '--others', '--exclude-standard'] })
	return { kind: 'files', files: [...new Set([...changed, ...untracked])].sort() }
}
