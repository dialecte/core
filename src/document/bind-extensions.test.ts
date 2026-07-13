import { bindExtensions } from './bind-extensions'

import { describe, it, expect } from 'vitest'

describe('bindExtensions', () => {
	it('undefined map -> empty object', () => {
		expect(bindExtensions(undefined, {})).toEqual({})
	})

	it('flat group -> binds instance as first arg (arg stripped from public signature)', () => {
		const instance = { tag: 'instance' }
		const bound = bindExtensions(
			{ feature: { greet: (self: unknown, name: string) => ({ self, name }) } },
			instance,
		)

		expect(bound.feature.greet('bob')).toEqual({ self: instance, name: 'bob' })
	})

	it('nested groups bind at arbitrary depth', () => {
		const instance = { tag: 'tx' }
		const bound = bindExtensions(
			{
				a: {
					aa: {
						getItems: (self: unknown, id: string) => ({ group: 'aa', self, id }),
					},
					aaa: {
						getItems: (self: unknown, id: string) => ({ group: 'aaa', self, id }),
					},
				},
			},
			instance,
		)

		expect(bound.a.aa.getItems('1')).toEqual({ group: 'aa', self: instance, id: '1' })
		expect(bound.a.aaa.getItems('2')).toEqual({ group: 'aaa', self: instance, id: '2' })
	})

	it('deep nesting (3+ levels) is preserved', () => {
		const instance = { tag: 'q' }
		const bound = bindExtensions({ a: { aa: { aaa: { run: (self: unknown) => self } } } }, instance)

		expect(bound.a.aa.aaa.run()).toBe(instance)
	})
})
