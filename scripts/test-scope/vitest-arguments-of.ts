import { BROWSER_PROJECT, LIST_FLAG, OWN_VALUE_FLAGS } from './test-scope.constants'

import type { BrowserRun } from './test-scope.types'

/** Whether the argument at `index` is one this tool reads: its own option, the `=` form, or the value after one. */
function isOwnArgument(params: { argv: readonly string[]; index: number }): boolean {
	const { argv, index } = params
	const argument = argv[index]
	if (argument === LIST_FLAG) return true
	if (OWN_VALUE_FLAGS.some((flag) => argument === flag || argument.startsWith(`${flag}=`)))
		return true
	return index > 0 && OWN_VALUE_FLAGS.includes(argv[index - 1])
}

/**
 * The arguments of the vitest run of a browser run: the browser project, its files, then every argument of the command
 * line this tool does not read itself (`--base`, `--selection-out` and their values, `--list`, the files it runs).
 */
export function vitestArgumentsOf(params: { argv: readonly string[]; run: BrowserRun }): string[] {
	const { argv, run } = params
	const passedOn = argv.filter(
		(argument, index) => !isOwnArgument({ argv, index }) && !run.files.includes(argument),
	)
	return ['run', '--project', BROWSER_PROJECT, ...run.files, ...passedOn]
}
