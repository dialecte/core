import { readFileSync } from 'node:fs'

import { GATE_SCOPE_VARIABLES } from './test-scope.constants'

import type { GateScope } from './test-scope.types'

/**
 * The scope a gate hands its scoped step: the base and tree it judges, the paths changed between them (read from the
 * file the gate names, NUL-separated) and where the step writes its selection. None outside a gate.
 */
export function gateScopeOf(params: {
	env: Readonly<Record<string, string | undefined>>
}): GateScope | undefined {
	const { env } = params
	const changedFile = env[GATE_SCOPE_VARIABLES.changed]
	if (!changedFile) return undefined
	const base = env[GATE_SCOPE_VARIABLES.base]
	const tree = env[GATE_SCOPE_VARIABLES.tree]
	const selectionPath = env[GATE_SCOPE_VARIABLES.selection]
	if (!base || !tree || !selectionPath) {
		const missing = [
			[GATE_SCOPE_VARIABLES.base, base],
			[GATE_SCOPE_VARIABLES.tree, tree],
			[GATE_SCOPE_VARIABLES.selection, selectionPath],
		]
			.filter(([, value]) => !value)
			.map(([name]) => name)
		throw new Error(`the gate named its changed paths without ${missing.join(', ')}`)
	}
	const changed = readFileSync(changedFile, 'utf8')
		.split('\0')
		.filter((path) => path.length > 0)
	return { base, tree, changed, selectionPath }
}
