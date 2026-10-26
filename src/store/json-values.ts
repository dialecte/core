import { throwDialecteError } from '@/errors'

/**
 * The JSON text of a value a store is handed. A store keeps plain JSON values only: strings, finite
 * numbers, booleans, null, and arrays and plain objects of them. A field holding `undefined` is
 * dropped, as JSON drops a symbol key and a property that is not enumerable; any other value - a
 * Date, a Map, a Set, NaN or Infinity, a BigInt, a function, a symbol, an instance of a class,
 * `undefined` in an array, a cycle - refuses the write with `STORE_VALUE_NOT_JSON`, before anything
 * is written. Every store checks what a write hands it through this. A getter is read twice (once
 * by JSON, once by the check).
 */
export function toJsonText(params: { value: unknown }): string | undefined {
	try {
		return JSON.stringify(params.value, refuseNonJson) as string | undefined
	} catch (thrown) {
		const cause = thrown instanceof Error ? thrown : undefined
		throwDialecteError('STORE_VALUE_NOT_JSON', { detail: cause?.message ?? String(thrown), cause })
	}
}

/** Check a value a write hands the store, as `toJsonText` checks it, for a store that encodes it itself. */
export function checkJsonValues(params: { value: unknown }): void {
	toJsonText(params)
}

/** The store's own copy of a value a write hands it, checked as `toJsonText` checks it. */
export function toJsonCopy<GenericValue>(params: { value: GenericValue }): GenericValue {
	const text = toJsonText(params)
	// `undefined` itself has no JSON text: it stays what it is
	return text === undefined ? params.value : (JSON.parse(text) as GenericValue)
}

/** JSON's replacer: `value` is what `toJSON` made of the held value, so the held one is checked. */
function refuseNonJson(this: unknown, field: string, value: unknown): unknown {
	const held = (this as Record<string, unknown>)[field]
	const refused = refusedKind({ held, value, inArray: Array.isArray(this) })
	if (refused) {
		throw new TypeError(`${refused} is not a JSON value${field ? ` (field "${field}")` : ''}`)
	}
	return value
}

/** What a held value is, when it is not JSON. */
function refusedKind(params: {
	held: unknown
	value: unknown
	inArray: boolean
}): string | undefined {
	const { held, value, inArray } = params
	switch (typeof held) {
		case 'string':
		case 'boolean':
			return undefined
		case 'number':
			return Number.isFinite(held) ? undefined : String(held)
		case 'undefined':
			return inArray ? 'undefined in an array' : undefined
		case 'bigint':
			return 'a BigInt'
		case 'function':
			return 'a function'
		case 'symbol':
			return 'a symbol'
	}
	if (held === null) return undefined
	if (!isOfRootClass({ value: held as object, name: Array.isArray(held) ? 'Array' : 'Object' })) {
		return `an instance of ${(held as object).constructor?.name || 'a class'}`
	}
	return held === value ? undefined : 'a value with toJSON'
}

/**
 * An object of no class of its own: a plain object (its prototype an `Object.prototype` of any
 * realm, or none) or a plain array (its prototype an `Array.prototype`). Known by the prototype's
 * own constructor's name, so a contrived prototype carrying a constructor named `Object` passes.
 */
function isOfRootClass(params: { value: object; name: 'Object' | 'Array' }): boolean {
	const { value, name } = params
	const prototype: unknown = Object.getPrototypeOf(value)
	if (prototype === null) return name === 'Object'
	const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
	return typeof constructor === 'function' && constructor.name === name
}
