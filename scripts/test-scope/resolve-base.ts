import { optionValueOf } from './option-value'
import { BASE_FLAG, DEFAULT_BASE, GATE_BASE_VARIABLE } from './test-scope.constants'

/** The ref a run compares with: `--base <ref>` (or `--base=<ref>`), else the gate's variable, else the default base. */
export function resolveBase(params: {
	argv: readonly string[]
	env: Readonly<Record<string, string | undefined>>
}): string {
	const { argv, env } = params
	return optionValueOf({ argv, flag: BASE_FLAG }) ?? (env[GATE_BASE_VARIABLE] || DEFAULT_BASE)
}
