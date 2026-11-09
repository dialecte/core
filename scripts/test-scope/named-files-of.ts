import { TEST_FILE_ARGUMENT } from './test-scope.constants'

/**
 * The test files named on the command line (a rerun of failing files, as a gate does it): every argument naming a test
 * file, whatever option comes before it.
 */
export function namedFilesOf(params: { argv: readonly string[] }): string[] {
	return params.argv.filter((argument) => TEST_FILE_ARGUMENT.test(argument))
}
