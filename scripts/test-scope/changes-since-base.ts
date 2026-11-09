import { changedFilesSince } from './changed-files'
import { DEFAULT_BASE, DEFAULT_BASE_FALLBACK } from './test-scope.constants'

import type { ChangesSinceBase } from './test-scope.types'

/**
 * What changed since `base`: the default base (`main`) falls back to `origin/main` when it does not resolve; any other
 * base is read as given. Neither resolving gives `unknown`, naming each base tried.
 */
export function changesSinceBase(params: { root: string; base: string }): ChangesSinceBase {
	const { root, base } = params
	const tried = base === DEFAULT_BASE ? [base, DEFAULT_BASE_FALLBACK] : [base]
	const unknown: string[] = []
	for (const candidate of tried) {
		const changes = changedFilesSince({ root, base: candidate })
		if (changes.kind === 'files') return { base: candidate, changes }
		unknown.push(changes.reason)
	}
	const reason =
		tried.length === 1
			? unknown[0]
			: `neither ${tried.join(' nor ')} is a ref sharing history with HEAD in this repository`
	return { base, changes: { kind: 'unknown', reason } }
}
