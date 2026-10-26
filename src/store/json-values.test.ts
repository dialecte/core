import { expectRejectsWith } from './contract/store-contract.fixtures'
import { toJsonCopy, toJsonText } from './json-values'

import { afterEach, describe, expect, it } from 'vitest'

/** An array of a class of its own. */
class HeldList extends Array<number> {}

describe('toJsonText', () => {
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
		'a cycle → refused': {
			value: () => {
				const held: Record<string, unknown> = {}
				held.self = held
				return held
			},
			detail: 'circular',
		},
	}

	for (const [description, testCase] of Object.entries(refusedCases)) {
		it(description, async () => {
			const value = testCase.value()
			await expectRejectsWith({
				action: Promise.resolve().then(function encode() {
					return toJsonText({ value })
				}),
				key: 'STORE_VALUE_NOT_JSON',
				detail: new RegExp(escapeRegExp(testCase.detail)),
			})
		})
	}

	type KeptCase = { value: () => unknown; expected: string }
	const keptCases: Record<string, KeptCase> = {
		'a proxy over a plain object → kept as the plain object it reads as': {
			value: () => ({ held: new Proxy({ a: 1 }, {}) }),
			expected: '{"held":{"a":1}}',
		},
		'an object without a prototype → kept as a plain object': {
			value: () => ({ held: Object.assign(Object.create(null) as object, { a: 1 }) }),
			expected: '{"held":{"a":1}}',
		},
	}

	for (const [description, testCase] of Object.entries(keptCases)) {
		it(description, () => {
			expect(toJsonText({ value: testCase.value() })).toBe(testCase.expected)
		})
	}

	describe('values of another realm', () => {
		const frames: HTMLIFrameElement[] = []
		afterEach(() => {
			for (const frame of frames.splice(0)) frame.remove()
		})

		function otherRealm(): typeof globalThis {
			const frame = document.createElement('iframe')
			document.body.append(frame)
			frames.push(frame)
			return frame.contentWindow as unknown as typeof globalThis
		}

		it('a plain object and an array of another realm → kept', () => {
			const realm = otherRealm()
			const value = realm.JSON.parse('{"list":[1],"held":{"a":"x"}}') as unknown
			expect(toJsonText({ value })).toBe('{"list":[1],"held":{"a":"x"}}')
		})

		it('a Date of another realm → refused', async () => {
			const realm = otherRealm()
			const value = { at: new realm.Date(0) }
			await expectRejectsWith({
				action: Promise.resolve().then(function encode() {
					return toJsonText({ value })
				}),
				key: 'STORE_VALUE_NOT_JSON',
				detail: /an instance of Date/,
			})
		})
	})
})

describe('toJsonCopy', () => {
	it('a value of JSON → an equal copy, none of the caller’s objects, undefined fields dropped', () => {
		const given = { list: [{ a: '1' }], kept: null, gone: undefined }
		const copy = toJsonCopy({ value: given })
		expect(copy).toStrictEqual({ list: [{ a: '1' }], kept: null })
		expect(copy.list).not.toBe(given.list)
	})

	it('undefined → undefined', () => {
		expect(toJsonCopy({ value: undefined })).toBeUndefined()
	})
})

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
