import { globSync } from 'node:fs'

export function assertEachPatternMatches(params: {
	root: string
	patterns: readonly string[]
	owner: string
}): void {
	const { root, patterns, owner } = params
	const unmatched = patterns.filter(function matchesNoFile(pattern) {
		return globSync(pattern, { cwd: root }).length === 0
	})
	if (unmatched.length > 0) {
		throw new Error(`${owner}: patterns naming no file: ${unmatched.join(', ')}`)
	}
}
