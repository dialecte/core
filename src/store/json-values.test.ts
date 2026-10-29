import { expectRejectsWith, nestedArrays } from './contract/store-contract.fixtures'
import { toJsonCopy } from './json-values'
import { JSON_MAX_DEPTH } from './json-values.constants'
import { JSON_VALUE_MEMBERS } from './json-values.fixtures'

import { describe, expect, it } from 'vitest'

import type { JsonWithRawJson } from './json-values.types'

/** An array of a class of its own. */
class HeldList extends Array<number> {}

/** An instance of a class whose `toJSON` cannot be read. */
class ThrowingToJson {
	get toJSON(): never {
		throw new Error('toJSON is not readable')
	}
}

type RefusedCase = { value: () => unknown; detail: string }
const refusedCases: Record<string, RefusedCase> = {
	'a Date → refused by its class, toJSON not taken': {
		value: () => ({ at: new Date(0) }),
		detail: 'an instance of Date is not a JSON value (field "at")',
	},
	'-Infinity → refused': {
		value: () => ({ n: Number.NEGATIVE_INFINITY }),
		detail: '-Infinity is not a JSON value (field "n")',
	},
	'a hole in an array → refused as undefined in an array': {
		// oxlint-disable-next-line no-sparse-arrays
		value: () => ({ list: [, 1] }),
		detail: 'undefined in an array is not a JSON value (field "0")',
	},
	'a plain object with toJSON → refused': {
		value: () => ({ held: { toJSON: () => 'x' } }),
		detail: 'a value with toJSON is not a JSON value (field "held")',
	},
	'a boxed string → refused by its class': {
		// oxlint-disable-next-line no-new-wrappers
		value: () => ({ held: new String('x') }),
		detail: 'an instance of String is not a JSON value (field "held")',
	},
	'an array of a class of its own → refused': {
		value: () => ({ held: HeldList.from([1]) }),
		detail: 'an instance of HeldList is not a JSON value (field "held")',
	},
	'an object inheriting from an object without a prototype → refused': {
		value: () => ({ held: Object.create(Object.create(null) as object) as object }),
		detail: 'an instance of a class is not a JSON value (field "held")',
	},
	'a value that is not JSON, alone → refused, no field named': {
		value: () => new Map(),
		detail: 'an instance of Map is not a JSON value',
	},
	'a cycle → refused, the field closing it named': {
		value: () => {
			const held: Record<string, unknown> = {}
			held.self = held
			return held
		},
		detail: 'a cycle is not a JSON value (field "self")',
	},
	'a plain object with a toJSON that is not enumerable and answers the object → refused': {
		value: () => ({
			held: Object.defineProperty({ a: 1 }, 'toJSON', {
				value: function answerItself(this: object) {
					return this
				},
			}),
		}),
		detail: 'a value with toJSON is not a JSON value (field "held")',
	},
	'an array with a toJSON answering the array → refused': {
		value: () => ({
			list: Object.assign([1], {
				toJSON: function answerItself(this: object) {
					return this
				},
			}),
		}),
		detail: 'a value with toJSON is not a JSON value (field "list")',
	},
	'an instance of a class whose toJSON getter throws → refused by its class': {
		value: () => ({ held: new ThrowingToJson() }),
		detail: 'an instance of ThrowingToJson is not a JSON value (field "held")',
	},
	'a raw JSON value → refused: JSON would write its text, not the object': {
		value: () => ({ held: (JSON as JsonWithRawJson).rawJSON?.('123') }),
		detail: 'a raw JSON value is not a JSON value (field "held")',
	},
	[`a value nested ${JSON_MAX_DEPTH + 1} levels deep → refused`]: {
		value: () => nestedArrays({ levels: JSON_MAX_DEPTH + 1 }),
		detail: `a value nested more than ${JSON_MAX_DEPTH} levels deep is not a JSON value (field "0")`,
	},
}

for (const [memberName, member] of Object.entries(JSON_VALUE_MEMBERS)) {
	describe(memberName, () => {
		for (const [description, testCase] of Object.entries(refusedCases)) {
			it(description, async () => {
				const value = testCase.value()
				await expectRejectsWith({
					action: Promise.resolve().then(function walk() {
						return member(value)
					}),
					key: 'STORE_VALUE_NOT_JSON',
					detail: new RegExp(`^${escapeRegExp(testCase.detail)}$`),
				})
			})
		}

		it('a plain object with toJSON → refused, its toJSON never called', async () => {
			const calls = { toJSON: 0 }
			const value = { held: { toJSON: () => ++calls.toJSON } }
			await expectRejectsWith({
				action: Promise.resolve().then(function walk() {
					return member(value)
				}),
				key: 'STORE_VALUE_NOT_JSON',
			})
			expect(calls.toJSON).toBe(0)
		})

		it('a field read through a getter → read once', () => {
			const calls = { get: 0 }
			const value = Object.defineProperty({}, 'held', {
				enumerable: true,
				get: () => `read ${++calls.get}`,
			})
			member(value)
			expect(calls.get).toBe(1)
		})

		it('an array read through a proxy → its length read once', () => {
			const reads = { length: 0 }
			const value = new Proxy([1, 2, 3], {
				get: (target, property, receiver) => {
					if (property === 'length') reads.length++
					return Reflect.get(target, property, receiver) as unknown
				},
			})
			member(value)
			expect(reads.length).toBe(1)
		})

		it('a getter answering a new plain object at each read → kept', () => {
			const value = Object.defineProperty({}, 'held', { enumerable: true, get: () => ({ a: 1 }) })
			expect(() => member(value)).not.toThrow()
		})

		it('one object held twice, not a cycle → kept', () => {
			const shared = { a: 1 }
			expect(() => member({ first: shared, second: [shared] })).not.toThrow()
		})

		it(`a value nested ${JSON_MAX_DEPTH} levels deep → kept`, () => {
			expect(() => member(nestedArrays({ levels: JSON_MAX_DEPTH }))).not.toThrow()
		})
	})
}

describe('toJsonCopy', () => {
	type KeptCase = { value: () => unknown; expected: unknown }
	const keptCases: Record<string, KeptCase> = {
		'a proxy over a plain object → kept as the plain object it reads as': {
			value: () => ({ held: new Proxy({ a: 1 }, {}) }),
			expected: { held: { a: 1 } },
		},
		'an object without a prototype → kept as a plain object': {
			value: () => ({ held: Object.assign(Object.create(null) as object, { a: 1 }) }),
			expected: { held: { a: 1 } },
		},
		'-0 → copied as 0, as JSON writes it': {
			value: () => ({ n: -0, list: [-0] }),
			expected: { n: 0, list: [0] },
		},
		'symbol keys, keys that are not enumerable and an array’s named properties → dropped': {
			value: () =>
				Object.defineProperty(
					{ [Symbol('held')]: 1, list: Object.assign([1], { named: 'x' }) },
					'hidden',
					{ value: 1, enumerable: false },
				),
			expected: { list: [1] },
		},
		'an empty key → kept': {
			value: () => ({ '': 'x' }),
			expected: { '': 'x' },
		},
		'a getter answering a new plain object → copied as it read': {
			value: () => Object.defineProperty({}, 'held', { enumerable: true, get: () => ({ a: 1 }) }),
			expected: { held: { a: 1 } },
		},
	}

	for (const [description, testCase] of Object.entries(keptCases)) {
		it(description, () => {
			expect(toJsonCopy({ value: testCase.value() })).toStrictEqual(testCase.expected)
		})
	}

	it('a value of JSON → an equal copy, none of the caller’s objects, undefined fields dropped', () => {
		const given = { list: [{ a: '1' }], kept: null, gone: undefined }
		const copy = toJsonCopy({ value: given })
		expect(copy).toStrictEqual({ list: [{ a: '1' }], kept: null })
		expect(copy.list).not.toBe(given.list)
		expect(copy.list[0]).not.toBe(given.list[0])
	})

	it('keys → in the order JSON gives them: index keys first, then as written', () => {
		const copy = toJsonCopy({ value: { b: 1, 2: 'two', a: 2, 1: 'one' } })
		expect(Object.keys(copy)).toEqual(['1', '2', 'b', 'a'])
	})

	it('one object held twice, not a cycle → copied twice, as two objects', () => {
		const shared = { a: 1 }
		const copy = toJsonCopy({ value: { first: shared, second: shared } })
		expect(copy).toStrictEqual({ first: { a: 1 }, second: { a: 1 } })
		expect(copy.first).not.toBe(copy.second)
	})

	it('an own __proto__ key → kept as a field, the copy a plain object', () => {
		const value = JSON.parse('{"__proto__":{"a":1},"b":2}') as Record<string, unknown>
		const copy = toJsonCopy({ value })
		expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
		expect(Object.keys(copy)).toEqual(['__proto__', 'b'])
		expect(Object.getOwnPropertyDescriptor(copy, '__proto__')?.value).toStrictEqual({ a: 1 })
	})

	it('undefined → undefined', () => {
		expect(toJsonCopy({ value: undefined })).toBeUndefined()
	})
})

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
