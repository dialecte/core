import { resolveBase } from './resolve-base'

import { describe, expect, it } from 'vitest'

type BaseCase = {
	argv: string[]
	env: Record<string, string | undefined>
	base: string
}

const CASES: Record<string, BaseCase> = {
	'`--base <ref>` names the base': {
		argv: ['--base', 'feature/x'],
		env: {},
		base: 'feature/x',
	},
	'`--base=<ref>` names the base': {
		argv: ['--list', '--base=abc123'],
		env: {},
		base: 'abc123',
	},
	'`--base` wins over the gate variable': {
		argv: ['--base', 'v1'],
		env: { DIALECTE_GATE_BASE: 'v2' },
		base: 'v1',
	},
	'without `--base`, the gate variable names it': {
		argv: ['--list'],
		env: { DIALECTE_GATE_BASE: '69fa3d3' },
		base: '69fa3d3',
	},
	'an empty gate variable counts as none: the default base, main': {
		argv: [],
		env: { DIALECTE_GATE_BASE: '' },
		base: 'main',
	},
	'neither: main': {
		argv: [],
		env: {},
		base: 'main',
	},
}

describe('resolveBase', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(resolveBase({ argv: testCase.argv, env: testCase.env })).toBe(testCase.base)
		})
	}

	for (const argv of [['--base'], ['--base', '--list'], ['--base=']]) {
		it(`no ref after \`--base\` (${argv.join(' ')}): refused, naming the flag`, () => {
			expect(() => resolveBase({ argv, env: {} })).toThrow(/--base needs a value/)
		})
	}
})
