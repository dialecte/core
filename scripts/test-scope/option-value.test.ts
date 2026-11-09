import { optionValueOf } from './option-value'

import { describe, expect, it } from 'vitest'

type OptionCase = {
	argv: string[]
	value: string | undefined
}

const CASES: Record<string, OptionCase> = {
	'`--selection-out <path>`': {
		argv: ['--base', 'main', '--selection-out', '.tmp/selection.json'],
		value: '.tmp/selection.json',
	},
	'`--selection-out=<path>`': { argv: ['--selection-out=out.json'], value: 'out.json' },
	'absent: none': { argv: ['--base', 'main'], value: undefined },
	'another option whose name starts the same is not it': {
		argv: ['--selection-outfile', 'x.json'],
		value: undefined,
	},
}

describe('optionValueOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(optionValueOf({ argv: testCase.argv, flag: '--selection-out' })).toBe(testCase.value)
		})
	}

	for (const argv of [
		['--selection-out'],
		['--selection-out', '--base', 'main'],
		['--selection-out='],
	]) {
		it(`no value after the option (${argv.join(' ')}): refused, naming the option`, () => {
			expect(() => optionValueOf({ argv, flag: '--selection-out' })).toThrow(
				/--selection-out needs a value/,
			)
		})
	}
})
