import { JSON_MAX_DEPTH, REFUSED_TYPES } from './json-values.constants'

import { throwDialecteError } from '@/errors'

import type { JsonKind, JsonWalkStep, JsonWithRawJson } from './json-values.types'

/**
 * Check a value a write hands the store. A store keeps plain JSON values only: strings, finite
 * numbers, booleans, null, and arrays and plain objects of them, nested at most `JSON_MAX_DEPTH`
 * levels counted from `value` (every store hands the same: a write's list of records or patches, or
 * the document). A field holding `undefined` is dropped, as JSON drops a symbol key and a property
 * that is not enumerable; any other value - a Date, a Map, a Set, NaN or Infinity, a BigInt, a
 * function, a symbol, an instance of a class, a raw JSON value, an object with a `toJSON` method
 * (never called), `undefined` in an array, a cycle, a value nested deeper - refuses the write with
 * `STORE_VALUE_NOT_JSON`, before anything is written. One walk, keys in the order JSON gives them,
 * each value read once: a value must read the same each time (a getter answering something else at
 * each read is checked as it read first).
 */
export function checkJsonValues(params: { value: unknown }): void {
	asStoreRefusal({
		walk: function check() {
			checkValue({ value: params.value, field: '', inArray: false, ancestors: [] })
		},
	})
}

/**
 * The store's own copy of a value a write hands it, checked as `checkJsonValues` checks it: what
 * `JSON.parse` would make of its JSON text, built without the text (`undefined` stays `undefined`).
 */
export function toJsonCopy<GenericValue>(params: { value: GenericValue }): GenericValue {
	return asStoreRefusal({
		walk: function copy() {
			return copyValue({ value: params.value, field: '', inArray: false, ancestors: [] })
		},
	}) as GenericValue
}

/** A walk's refusal - or anything else thrown while it reads the value - as the store's refusal. */
function asStoreRefusal<GenericResult>(params: { walk: () => GenericResult }): GenericResult {
	try {
		return params.walk()
	} catch (thrown) {
		const cause = thrown instanceof Error ? thrown : undefined
		throwDialecteError('STORE_VALUE_NOT_JSON', { detail: cause?.message ?? String(thrown), cause })
	}
}

function checkValue(step: JsonWalkStep): void {
	const kind = kindOf(step)
	if (kind === 'leaf') return
	const { ancestors } = step
	ancestors.push(step.value as object)
	if (kind === 'array') {
		const held = step.value as unknown[]
		const { length } = held
		for (let index = 0; index < length; index++) {
			const member = held[index]
			if (!isJsonLeaf({ value: member })) {
				checkValue({ value: member, field: index, inArray: true, ancestors })
			}
		}
	} else {
		const held = step.value as Record<string, unknown>
		for (const key of Object.keys(held)) {
			const member = held[key]
			if (!isJsonLeaf({ value: member })) {
				checkValue({ value: member, field: key, inArray: false, ancestors })
			}
		}
	}
	ancestors.pop()
}

function copyValue(step: JsonWalkStep): unknown {
	const kind = kindOf(step)
	if (kind === 'leaf') return leafCopy({ value: step.value })
	const { ancestors } = step
	ancestors.push(step.value as object)
	const copy = kind === 'array' ? copyArray(step) : copyObject(step)
	ancestors.pop()
	return copy
}

function copyArray(step: JsonWalkStep): unknown[] {
	const { ancestors } = step
	const held = step.value as unknown[]
	const copy: unknown[] = []
	const { length } = held
	for (let index = 0; index < length; index++) {
		const member = held[index]
		copy.push(
			isJsonLeaf({ value: member })
				? leafCopy({ value: member })
				: copyValue({ value: member, field: index, inArray: true, ancestors }),
		)
	}
	return copy
}

function copyObject(step: JsonWalkStep): Record<string, unknown> {
	const { ancestors } = step
	const held = step.value as Record<string, unknown>
	const copy: Record<string, unknown> = {}
	for (const key of Object.keys(held)) {
		const value = held[key]
		const member = isJsonLeaf({ value })
			? leafCopy({ value })
			: copyValue({ value, field: key, inArray: false, ancestors })
		if (member === undefined) continue
		// an own `__proto__` key, as `JSON.parse` makes it: a field, never the prototype
		if (key === '__proto__') {
			Object.defineProperty(copy, key, {
				value: member,
				writable: true,
				enumerable: true,
				configurable: true,
			})
		} else copy[key] = member
	}
	return copy
}

/** A value kept as it is, as JSON writes it: `-0` as `0`. */
function leafCopy(params: { value: unknown }): unknown {
	return params.value === 0 ? 0 : params.value
}

/** A string, a boolean, a finite number or null: kept as it is wherever it is held. */
function isJsonLeaf(params: { value: unknown }): boolean {
	const { value } = params
	switch (typeof value) {
		case 'string':
		case 'boolean':
			return true
		case 'number':
			return Number.isFinite(value)
		case 'object':
			return value === null
		default:
			return false
	}
}

/** What a value is to the walk: kept as it is, or walked into; any value that is not JSON refuses. */
function kindOf(step: JsonWalkStep): JsonKind {
	const { value } = step
	const type = typeof value
	switch (type) {
		case 'string':
		case 'boolean':
			return 'leaf'
		case 'number':
			return Number.isFinite(value) ? 'leaf' : refuse({ step, kind: String(value) })
		case 'undefined':
			// `document.all` is an object that reads as undefined: JSON would write its members
			if (value !== undefined) return containerKind({ step, held: value as object })
			return step.inArray ? refuse({ step, kind: 'undefined in an array' }) : 'leaf'
		case 'object':
			return value === null ? 'leaf' : containerKind({ step, held: value as object })
		default:
			return refuse({ step, kind: REFUSED_TYPES[type] })
	}
}

/**
 * A plain array or a plain object, else refused: of a class of its own, a raw JSON value, with a
 * `toJSON` (JSON would keep what it answers, not the value), one of its own ancestors (a cycle), or
 * too deep.
 */
function containerKind(params: { step: JsonWalkStep; held: object }): JsonKind {
	const { step, held } = params
	const isArray = Array.isArray(held)
	const prototype: unknown = Object.getPrototypeOf(held)
	if (!isRootPrototype({ prototype, name: isArray ? 'Array' : 'Object' })) {
		refuse({ step, kind: `an instance of ${held.constructor?.name || 'a class'}` })
	}
	// a raw JSON value (`JSON.rawJSON`) has no prototype: JSON would write its text, not the object
	if (prototype === null && (JSON as JsonWithRawJson).isRawJSON?.(held)) {
		refuse({ step, kind: 'a raw JSON value' })
	}
	if (typeof (held as { toJSON?: unknown }).toJSON === 'function') {
		refuse({ step, kind: 'a value with toJSON' })
	}
	if (step.ancestors.includes(held)) refuse({ step, kind: 'a cycle' })
	if (step.ancestors.length >= JSON_MAX_DEPTH) {
		refuse({ step, kind: `a value nested more than ${JSON_MAX_DEPTH} levels deep` })
	}
	return isArray ? 'array' : 'object'
}

/**
 * The prototype of an object of no class of its own: `Object.prototype` (or none) for a plain
 * object, `Array.prototype` for a plain array, of this realm or of another one - known by its own
 * constructor's name, so a contrived prototype carrying a constructor named `Object` passes.
 */
function isRootPrototype(params: { prototype: unknown; name: 'Object' | 'Array' }): boolean {
	const { prototype, name } = params
	if (prototype === (name === 'Array' ? Array.prototype : Object.prototype)) return true
	if (prototype === null) return name === 'Object'
	const constructor: unknown = Object.getOwnPropertyDescriptor(
		prototype as object,
		'constructor',
	)?.value
	return typeof constructor === 'function' && constructor.name === name
}

function refuse(params: { step: JsonWalkStep; kind: string }): never {
	const field = String(params.step.field)
	throw new TypeError(`${params.kind} is not a JSON value${field ? ` (field "${field}")` : ''}`)
}
