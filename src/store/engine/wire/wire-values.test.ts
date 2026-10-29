import { CONTRACT_LONE_SURROGATE_TEXT } from '../../contract/store-contract.constants'
import { fromWireArgs, fromWireValues, toWireArgs, toWireValues } from './wire-values'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { checkJsonValues } from '@/store/json-values'
import { JSON_MAX_DEPTH } from '@/store/json-values.constants'

import type { JsonWithRawJson } from '@/store/json-values.types'

/** Values as the other side of a port receives them. */
function acrossPort(values: unknown[]): unknown[] {
	return fromWireValues(structuredClone(toWireValues({ values })))
}

/** What the store's one JSON check answers for a value: nothing, or its refusal's key and detail. */
function checkOutcome(params: { value: unknown }): { key: string; detail: string } | 'kept' {
	try {
		checkJsonValues({ value: params.value })
		return 'kept'
	} catch (thrown) {
		const error = toDialecteError(thrown)
		return { key: error?.key ?? 'none', detail: error?.detail ?? String(thrown) }
	}
}

class HeldInstance {}

/** Each value that is not plain JSON, as the store contract builds them. */
const NON_JSON_VALUES: Record<string, () => unknown> = {
	'a Date': () => new Date(0),
	'a Map holding a function': () => new Map([['k', () => '']]),
	'a Set': () => new Set(['v']),
	NaN: () => Number.NaN,
	Infinity: () => Number.POSITIVE_INFINITY,
	'a BigInt': () => BigInt(1),
	'a function': () => () => '',
	'a symbol': () => Symbol('held'),
	'an instance of a class': () => new HeldInstance(),
	'an array holding undefined': () => [undefined],
	'a raw JSON value': () => (JSON as JsonWithRawJson).rawJSON?.('1'),
	'text holding a lone surrogate': () => CONTRACT_LONE_SURROGATE_TEXT,
	'an object whose key holds a lone surrogate': () => ({ [CONTRACT_LONE_SURROGATE_TEXT]: 1 }),
	'an object with a toJSON function': () => ({ toJSON: () => 1 }),
	'an object whose getter throws': () =>
		Object.defineProperty({}, 'held', {
			enumerable: true,
			get() {
				throw new Error('not readable')
			},
		}),
	'an object made from another (Object.create)': () => Object.create({ inherited: 1 }) as object,
	'an array whose prototype is Object.prototype': () =>
		Object.setPrototypeOf([1], Object.prototype) as object,
	'a revoked proxy': () => {
		const { proxy, revoke } = Proxy.revocable({}, {})
		revoke()
		return proxy
	},
	'a proxy whose keys trap throws': () =>
		new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('no keys')
				},
			},
		),
}

/** Where a write holds a value; a function before it, so the place among other refusals counts. */
const PLACES: Record<string, (value: unknown) => unknown> = {
	'a record attribute': (value) => [
		{ id: 'r1', attributes: [{ name: 'a', value: 'kept' }] },
		{ id: 'r2', attributes: [{ name: 'b', value }], value: () => 'second' },
	],
	'an array member after a function': (value) => [[() => 'first', value]],
	'a field named __proto__': (value) => {
		const holder = JSON.parse('{"__proto__":{"inner":null}}') as {
			['__proto__']: { inner: unknown }
		}
		holder['__proto__'].inner = value
		return holder
	},
	'a container holding a cycle': (value) => {
		const holder: Record<string, unknown> = { id: 'r1' }
		holder.self = holder
		holder.held = value
		return holder
	},
}

describe('values a write hands the store, carried across a port', () => {
	for (const [place, holding] of Object.entries(PLACES)) {
		for (const [kind, value] of Object.entries(NON_JSON_VALUES)) {
			it(`${kind} in ${place} → refused by the store's check as the value itself is`, () => {
				const held = holding(value())
				const expected = checkOutcome({ value: held })
				const [received] = acrossPort([held])
				expect(expected).not.toBe('kept')
				expect(checkOutcome({ value: received })).toEqual(expected)
			})
		}
	}

	it(`${Object.keys(NON_JSON_VALUES).length} values at the root of each argument → each refused as itself`, () => {
		const values = Object.values(NON_JSON_VALUES).map((value) => value())
		const received = acrossPort(values)
		values.forEach((value, index) => {
			expect(checkOutcome({ value: received[index] })).toEqual(checkOutcome({ value }))
		})
	})

	it('a record whose id getter throws → reading its id on the other side throws the same, as the engine reads ids before the check', () => {
		const record = Object.defineProperty({ attributes: [] }, 'id', {
			enumerable: true,
			get() {
				throw new Error('no id')
			},
		})
		const [received] = acrossPort([[record]])
		expect(() => (received as { id: string }[])[0]!.id).toThrow('no id')
		expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value: [record] }))
	})

	it('a patch that is an instance of a class → crosses an instance holding its fields: its recordId read as given, refused by the check as the instance', () => {
		const patch = Object.assign(new HeldInstance(), { recordId: 'r1', value: 'v' })
		const [received] = acrossPort([[patch]])
		expect((received as { recordId: string }[])[0]!.recordId).toBe('r1')
		expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value: [patch] }))
	})

	it('a proxy over a plain record (a reactive object) → crosses as the plain record it reads as', () => {
		const record = { id: 'r1', attributes: [{ name: 'a', value: '1' }] }
		const reactive = new Proxy(record, {})
		expect(() => structuredClone(reactive)).toThrow()
		expect(acrossPort([[reactive]])).toEqual([[record]])
	})

	it('JSON values with undefined fields and a key named __proto__ → the same values, the fields as given', () => {
		const document = JSON.parse('{"id":"doc-1","metadata":{"__proto__":{"x":1}}}') as Record<
			string,
			unknown
		>
		document.name = undefined
		const [received] = acrossPort([document])
		expect(received).toEqual(document)
		expect(Object.getPrototypeOf((received as { metadata: object }).metadata)).toBe(
			Object.prototype,
		)
		expect(checkOutcome({ value: received })).toBe('kept')
	})

	it('text and a key holding a lone surrogate → cross as they are, no stand-in named', () => {
		const held = { [CONTRACT_LONE_SURROGATE_TEXT]: [CONTRACT_LONE_SURROGATE_TEXT] }
		const wire = toWireValues({ values: [held] })
		expect(wire.standIns).toEqual([])
		expect(fromWireValues(structuredClone(wire))).toStrictEqual([held])
	})

	it('a cycle → refused as a cycle', () => {
		const record: Record<string, unknown> = { id: 'r1' }
		record.self = record
		const [received] = acrossPort([record])
		expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value: record }))
	})

	it(`a value nested ${JSON_MAX_DEPTH + 1} levels deep and one far deeper → refused as nested too deep`, () => {
		for (const levels of [JSON_MAX_DEPTH + 1, JSON_MAX_DEPTH * 20]) {
			let value: unknown = 'leaf'
			for (let level = 0; level < levels; level += 1) value = [value]
			const [received] = acrossPort([value])
			expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value }))
		}
	})

	it('a class instance pointing back at itself → refused as the instance, its plain fields crossing', () => {
		class Node {
			id = 'n1'
			parent: Node | undefined = undefined
		}
		const node = new Node()
		node.parent = node
		const [received] = acrossPort([[node]])
		expect((received as { id: string }[])[0]!.id).toBe('n1')
		expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value: [node] }))
	})

	it('a proxy over a class instance whose keys trap throws → refused as the instance', () => {
		const held = new Proxy(new HeldInstance(), {
			ownKeys() {
				throw new Error('no keys')
			},
		})
		const [received] = acrossPort([[held]])
		expect(checkOutcome({ value: received })).toEqual(checkOutcome({ value: [held] }))
	})

	it('the arguments of a commit, reactive all through (its deletes too) → cross as the plain data they read as', () => {
		const params = new Proxy(
			{
				documentId: 'doc-1',
				writeId: 'w1',
				creates: new Proxy([{ id: 'r1', attributes: [] }], {}),
				updates: [],
				deletes: new Proxy(['r9'], {}),
			},
			{},
		)
		const places = [
			{ argument: 0, path: ['creates'] },
			{ argument: 0, path: ['updates'] },
		]
		const wire = toWireArgs({ args: [params], places })
		const received = fromWireArgs({ ...structuredClone(wire), places })
		expect(received).toEqual([
			{
				documentId: 'doc-1',
				writeId: 'w1',
				creates: [{ id: 'r1', attributes: [] }],
				updates: [],
				deletes: ['r9'],
			},
		])
	})
})
