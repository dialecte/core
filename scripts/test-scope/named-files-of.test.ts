import { namedFilesOf } from './named-files-of'

import { describe, expect, it } from 'vitest'

type NamedCase = {
	argv: string[]
	files: string[]
}

const CASES: Record<string, NamedCase> = {
	"a gate's serial rerun: the failing files, in order": {
		argv: [
			'src/store/sqlite/served/hub/hub.browser.test.ts',
			'src/store/local/dexie-store.test.ts',
			'--no-file-parallelism',
		],
		files: [
			'src/store/sqlite/served/hub/hub.browser.test.ts',
			'src/store/local/dexie-store.test.ts',
		],
	},
	'options and their values are not files': {
		argv: ['--base', 'main', '--reporter', 'dot', '--selection-out', 'out.json', '--retry=1'],
		files: [],
	},
	'a file after the options': {
		argv: ['--base=main', '--list', 'src/utils/save-to-disk.test.ts'],
		files: ['src/utils/save-to-disk.test.ts'],
	},
	'nothing named: none': { argv: [], files: [] },
}

describe('namedFilesOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(namedFilesOf({ argv: testCase.argv })).toEqual(testCase.files)
		})
	}
})
