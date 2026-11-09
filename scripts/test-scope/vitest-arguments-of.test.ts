import { browserRunOf } from './browser-run-of'
import { namedFilesOf } from './named-files-of'
import { BROWSER_FILES } from './test-scope.fixtures'
import { vitestArgumentsOf } from './vitest-arguments-of'

import { describe, expect, it } from 'vitest'

type ArgumentsCase = {
	argv: string[]
	arguments: string[]
}

const FILES = ['src/store/sqlite/load-sqlite.test.ts', 'src/utils/save-to-disk.test.ts']

const CASES: Record<string, ArgumentsCase> = {
	'no option: run, the browser project, the files in order': {
		argv: [],
		arguments: ['run', '--project', 'browser', ...FILES],
	},
	"this tool's own options and their values are left out, the others passed on after the files": {
		argv: [
			'--base',
			'main',
			'--retry=1',
			'--selection-out',
			'out.json',
			'--list',
			'--reporter',
			'dot',
		],
		arguments: ['run', '--project', 'browser', ...FILES, '--retry=1', '--reporter', 'dot'],
	},
	'files named on the command line are the run: not passed a second time': {
		argv: ['src/utils/save-to-disk.test.ts', '--no-file-parallelism'],
		arguments: ['run', '--project', 'browser', ...FILES, '--no-file-parallelism'],
	},
	'the runner option and its value are left out': {
		argv: ['--runner', 'vitest', '--retry=1'],
		arguments: ['run', '--project', 'browser', ...FILES, '--retry=1'],
	},
	'the `=` forms of its own options are left out too': {
		argv: ['--base=main', '--selection-out=out.json', '--bail=1'],
		arguments: ['run', '--project', 'browser', ...FILES, '--bail=1'],
	},
}

describe('vitestArgumentsOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(vitestArgumentsOf({ argv: testCase.argv, run: { files: FILES } })).toEqual(
				testCase.arguments,
			)
		})
	}

	it("a gate's serial rerun of the step (`npm run test:scope -- <files> --no-file-parallelism`): exactly those files, serially", () => {
		// the gate appends the failing files and the serial flag to the step's command, the script's own option first
		const argv = [
			'--runner',
			'vitest',
			'src/store/sqlite/served/hub/hub.browser.test.ts',
			'src/utils/save-to-disk.test.ts',
			'--no-file-parallelism',
		]
		const selection = {
			tiers: ['T0', 'T1', 'T2', 'T3', 'T4'] as const,
			browserFiles: FILES.map((path) => ({ path, tier: 'T4' as const, reasons: ['changed'] })),
		}
		expect(
			vitestArgumentsOf({
				argv,
				run: browserRunOf({
					selection: { ...selection, tiers: [...selection.tiers] },
					namedFiles: namedFilesOf({ argv }),
				}),
			}),
		).toEqual([
			'run',
			'--project',
			'browser',
			'src/store/sqlite/served/hub/hub.browser.test.ts',
			'src/utils/save-to-disk.test.ts',
			'--no-file-parallelism',
		])
	})

	// vitest reads a file argument as a filter on the path: a browser file whose path holds another's would run unselected
	it('no browser file path holds another: each file argument names exactly one browser file', () => {
		expect(
			BROWSER_FILES.flatMap((path) =>
				BROWSER_FILES.filter((other) => other !== path && other.includes(path)).map(
					(other) => `${path} in ${other}`,
				),
			),
		).toEqual([])
	})
})
