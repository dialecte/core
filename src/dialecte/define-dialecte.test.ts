import { defineDialecte } from './define-dialecte'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE_CONFIG } from '@/test/config'

import type { DialecteHooks } from '@/types'

const CONFIGS = { first: TEST_DIALECTE_CONFIG, second: TEST_DIALECTE_CONFIG }
const MODULES = { counting: { query: { countA: () => 0 } } }
const HOOKS: DialecteHooks<typeof TEST_DIALECTE_CONFIG> = { beforeImport: (xml) => xml }

describe('defineDialecte', () => {
	type TestCase = {
		params: Parameters<typeof defineDialecte<typeof TEST_DIALECTE_CONFIG>>[0]
		expected: {
			id: string
			version: string
			configKeys: string[]
			defaultConfigKey: string
			extensionKeys: string[]
			hooks: DialecteHooks<typeof TEST_DIALECTE_CONFIG>
		}
	}

	const testCases: Record<string, TestCase> = {
		'every config, the default key, the extensions and the hooks are kept as given': {
			params: {
				id: 'core/test',
				version: '1.2.3',
				configs: CONFIGS,
				defaultConfigKey: 'second',
				extensions: MODULES,
				createHooks: () => HOOKS,
			},
			expected: {
				id: 'core/test',
				version: '1.2.3',
				configKeys: ['first', 'second'],
				defaultConfigKey: 'second',
				extensionKeys: ['counting'],
				hooks: HOOKS,
			},
		},
		'no extensions and no hooks: an empty module record and hooks with nothing in them': {
			params: {
				id: 'core/test',
				version: '0.0.0',
				configs: { only: TEST_DIALECTE_CONFIG },
				defaultConfigKey: 'only',
			},
			expected: {
				id: 'core/test',
				version: '0.0.0',
				configKeys: ['only'],
				defaultConfigKey: 'only',
				extensionKeys: [],
				hooks: {},
			},
		},
	}

	for (const [description, { params, expected }] of Object.entries(testCases)) {
		it(description, () => {
			const dialecte = defineDialecte(params)

			expect(dialecte.id).toBe(expected.id)
			expect(dialecte.version).toBe(expected.version)
			expect(Object.keys(dialecte.configs)).toEqual(expected.configKeys)
			expect(dialecte.defaultConfigKey).toBe(expected.defaultConfigKey)
			expect(Object.keys(dialecte.extensions)).toEqual(expected.extensionKeys)
			expect(dialecte.createHooks()).toEqual(expected.hooks)
		})
	}

	it('calls the hooks factory anew on every createHooks call: no hook state is shared', () => {
		let calls = 0
		const dialecte = defineDialecte({
			id: 'core/test',
			version: '0.0.0',
			configs: CONFIGS,
			defaultConfigKey: 'first',
			createHooks: () => {
				calls++
				return {}
			},
		})
		expect(calls).toBe(0)
		expect(dialecte.createHooks()).not.toBe(dialecte.createHooks())
		expect(calls).toBe(2)
	})

	it('the declaration is frozen', () => {
		const dialecte = defineDialecte({
			id: 'core/test',
			version: '0.0.0',
			configs: CONFIGS,
			defaultConfigKey: 'first',
		})
		expect(Object.isFrozen(dialecte)).toBe(true)
	})

	const invalidCases: Record<string, { declare: () => unknown; key: string; detail: string }> = {
		'a default key that names no config': {
			declare: () =>
				defineDialecte({
					id: 'core/test',
					version: '0.0.0',
					configs: CONFIGS,
					defaultConfigKey: 'third' as 'first',
				}),
			key: 'UNKNOWN_CONFIG_KEY',
			detail: 'third',
		},
		'no config at all': {
			declare: () =>
				defineDialecte({
					id: 'core/test',
					version: '0.0.0',
					configs: {} as typeof CONFIGS,
					defaultConfigKey: 'first',
				}),
			key: 'UNKNOWN_CONFIG_KEY',
			detail: 'first',
		},
	}

	for (const [description, { declare, key, detail }] of Object.entries(invalidCases)) {
		it(`refuses ${description}`, () => {
			let thrown: unknown
			try {
				declare()
			} catch (error) {
				thrown = error
			}
			const error = toDialecteError(thrown)
			expect(error?.key).toBe(key)
			expect(error?.detail).toContain(detail)
		})
	}
})
