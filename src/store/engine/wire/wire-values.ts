import { isRootPrototype } from '@/store/json-values'
import { JSON_MAX_DEPTH } from '@/store/json-values.constants'

import type {
	WireCopyStep,
	WireJsonPlace,
	WireStandIn,
	WireStandInKind,
	WireValues,
} from './wire.types'
import type { JsonWithRawJson } from '@/store/json-values.types'

/**
 * The values of a call's arguments as plain data a port carries, read once, keys in their order: a
 * proxy over plain data (a reactive object) crosses as what it reads as, as every store keeps it. A
 * value that would not cross as it is - a function, a symbol, an instance of a class, a raw JSON
 * value, an object with a `toJSON` function, a value whose reading throws (a getter, a proxy trap) -
 * is left out and named as a stand-in, so the store's JSON check on the other side refuses it where
 * and as it refuses the value itself. A cycle is kept as a cycle; what is nested deeper than the
 * check reads is cut, the container that is too deep kept (empty).
 */
export function toWireValues(params: { values: readonly unknown[] }): WireValues {
	const standIns: WireStandIn[] = []
	const values = params.values.map(function copyArgument(value, index) {
		return copyMember({
			step: { index, path: [], ancestors: new Map(), standIns },
			read: function readArgument() {
				return value
			},
		})
	})
	return { values, standIns }
}

/** The values back, each stand-in rebuilt where it was. */
export function fromWireValues(params: WireValues): unknown[] {
	const values = [...params.values]
	for (const standIn of params.standIns) {
		const { index, path } = standIn
		if (path.length === 0) {
			values[index] = rebuildStandIn({ standIn, held: values[index] })
			continue
		}
		let container = values[index] as Record<string | number, unknown>
		for (const field of path.slice(0, -1)) {
			container = container[field] as Record<string | number, unknown>
		}
		placeStandIn({ container, field: path[path.length - 1]!, standIn })
	}
	return values
}

/**
 * A member read and copied; what throws while it is read (a getter) or looked into (a proxy's trap)
 * is named a stand-in throwing the same message at the same step - before anything under it was
 * named, since a member is looked into before it is walked.
 */
function copyMember(params: { step: WireCopyStep; read: () => unknown }): unknown {
	const { step, read } = params
	let value: unknown
	try {
		value = read()
	} catch (thrown) {
		return standIn({ step, kind: 'throwing-read', message: messageOf({ thrown }) })
	}
	try {
		return copyValue({ step, value })
	} catch (thrown) {
		return standIn({ step, kind: 'throwing-inspection', message: messageOf({ thrown }) })
	}
}

function messageOf(params: { thrown: unknown }): string {
	const { thrown } = params
	return thrown instanceof Error ? thrown.message : String(thrown)
}

function copyValue(params: { step: WireCopyStep; value: unknown }): unknown {
	const { step, value } = params
	switch (typeof value) {
		case 'function':
			return standIn({ step, kind: 'function' })
		case 'symbol':
			return standIn({ step, kind: 'symbol', text: value.description })
		case 'object':
			return value === null ? null : copyContainer({ step, held: value })
		default:
			return value
	}
}

/** A container: refused kinds named, a cycle kept, too deep cut, else copied member by member. */
function copyContainer(params: { step: WireCopyStep; held: object }): unknown {
	const { step, held } = params
	const isArray = Array.isArray(held)
	const prototype: unknown = Object.getPrototypeOf(held)
	if (!isRootPrototype({ prototype, name: isArray ? 'Array' : 'Object' })) {
		return copyInstance({ step, held })
	}
	if (prototype === null && (JSON as JsonWithRawJson).isRawJSON?.(held)) {
		return standIn({ step, kind: 'raw-json', text: (held as { rawJSON: string }).rawJSON })
	}
	if (typeof (held as { toJSON?: unknown }).toJSON === 'function') {
		return standIn({ step, kind: 'to-json' })
	}
	if (step.ancestors.has(held)) return step.ancestors.get(held)
	// the check refuses a container this deep whatever it holds
	if (step.ancestors.size >= JSON_MAX_DEPTH) return isArray ? [] : {}
	const keys = isArray ? undefined : Object.keys(held)
	const copy: unknown[] | Record<string, unknown> = isArray ? [] : {}
	step.ancestors.set(held, copy)
	try {
		if (isArray) copyMembers({ step, held: held as unknown[], copy: copy as unknown[] })
		else {
			copyFields({
				step,
				held: held as Record<string, unknown>,
				keys: keys!,
				copy: copy as Record<string, unknown>,
			})
		}
	} finally {
		step.ancestors.delete(held)
	}
	return copy
}

/**
 * An instance of a class, named a stand-in rebuilt as an instance of that name holding its own
 * fields that are strings, finite numbers, booleans or null, one level down: the engine may read one
 * of them (a patch's `recordId`) before its check refuses the instance itself - which it does before
 * reading anything else of it, so nothing else of it crosses. Keys that cannot be listed or read
 * leave those fields out.
 */
function copyInstance(params: { step: WireCopyStep; held: object }): Record<string, unknown> {
	const { step, held } = params
	standIn({ step, kind: 'instance', name: held.constructor?.name ?? '' })
	const leaves: Record<string, unknown> = {}
	if (ArrayBuffer.isView(held) || held instanceof ArrayBuffer) return leaves
	try {
		for (const key of Object.keys(held)) {
			const member: unknown = (held as Record<string, unknown>)[key]
			if (!isPlainLeaf({ value: member })) continue
			Object.defineProperty(leaves, key, {
				value: member,
				writable: true,
				enumerable: true,
				configurable: true,
			})
		}
	} catch {
		// an instance the check refuses before it reads a key: its fields stay behind
	}
	return leaves
}

function isPlainLeaf(params: { value: unknown }): boolean {
	const { value } = params
	const type = typeof value
	return (
		value === null ||
		type === 'string' ||
		type === 'boolean' ||
		(type === 'number' && Number.isFinite(value))
	)
}

function copyMembers(params: { step: WireCopyStep; held: unknown[]; copy: unknown[] }): void {
	const { step, held, copy } = params
	const { length } = held
	for (let member = 0; member < length; member += 1) {
		step.path.push(member)
		try {
			copy.push(
				copyMember({
					step,
					read: function readMember() {
						return held[member]
					},
				}),
			)
		} finally {
			step.path.pop()
		}
	}
}

function copyFields(params: {
	step: WireCopyStep
	held: Record<string, unknown>
	keys: string[]
	copy: Record<string, unknown>
}): void {
	const { step, held, keys, copy } = params
	for (const key of keys) {
		step.path.push(key)
		let member: unknown
		try {
			member = copyMember({
				step,
				read: function readField() {
					return held[key]
				},
			})
		} finally {
			step.path.pop()
		}
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
}

/** The value left out and named: `null` holds its place in the copy. */
function standIn(params: {
	step: WireCopyStep
	kind: WireStandInKind
	name?: string
	text?: string
	message?: string
}): null {
	const { step, kind, name, text, message } = params
	step.standIns.push({ index: step.index, path: [...step.path], kind, name, text, message })
	return null
}

function rebuildStandIn(params: { standIn: WireStandIn; held?: unknown }): unknown {
	const { kind, name = '', text, message } = params.standIn
	switch (kind) {
		case 'function':
			return function standInFunction() {}
		case 'symbol':
			return Symbol(text)
		case 'instance':
			return withOwnFields({ target: instanceNamed({ name }), fields: params.held })
		case 'raw-json':
			return (JSON as JsonWithRawJson).rawJSON?.(text ?? 'null')
		case 'to-json':
			return { toJSON: function standInToJson() {} }
		case 'throwing-read':
		case 'throwing-inspection':
			return throwingWhenLookedInto({ message: message ?? '' })
	}
}

/**
 * A stand-in set in its container as an own field (`__proto__` included, as `JSON.parse` makes it):
 * a value whose reading threw as a getter throwing the same message - the engine may read a field
 * (an id) before its check does.
 */
function placeStandIn(params: {
	container: Record<string | number, unknown>
	field: string | number
	standIn: WireStandIn
}): void {
	const { container, field, standIn } = params
	if (standIn.kind === 'throwing-read') {
		Object.defineProperty(container, field, {
			enumerable: true,
			configurable: true,
			get: function throwAsHeld() {
				throw new Error(standIn.message)
			},
		})
		return
	}
	Object.defineProperty(container, field, {
		value: rebuildStandIn({ standIn, held: container[field] }),
		writable: true,
		enumerable: true,
		configurable: true,
	})
}

/**
 * An instance of a class of that name - `Object` included: its prototype holds no constructor of its
 * own (the check then sees a class instance whatever the name) and inherits one of that name (the
 * check's refusal names it).
 */
function instanceNamed(params: { name: string }): object {
	const { name } = params
	const named = { [name]: class {} }[name]!
	return Object.create(Object.create(named.prototype) as object) as object
}

/** `target` holding each own field of `fields` as an own field (`__proto__` included, never the prototype). */
function withOwnFields(params: { target: object; fields: unknown }): object {
	const { target, fields } = params
	for (const [key, value] of Object.entries((fields ?? {}) as Record<string, unknown>)) {
		Object.defineProperty(target, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		})
	}
	return target
}

/** A value whose inspection by the check throws `message`, as reading or looking into the original did. */
function throwingWhenLookedInto(params: { message: string }): object {
	const { message } = params
	return new Proxy(
		{},
		{
			getPrototypeOf: function throwAsHeld() {
				throw new Error(message)
			},
		},
	)
}

/**
 * A call's arguments as a port carries them: the values at its JSON places copied by
 * `toWireValues` (stand-ins indexed by place), every other argument as it is (a `File`, a `Blob`).
 */
export function toWireArgs(params: {
	args: readonly unknown[]
	places: readonly WireJsonPlace[]
}): { args: unknown[]; standIns: WireStandIn[] } {
	const { args, places } = params
	const plainArgs = args.map(function plainArgument(arg, argument) {
		const held = places.filter(function placeOfArgument(place) {
			return place.argument === argument
		})
		// an argument checked whole is copied by `toWireValues`; the checked fields of one are left to it
		if (held.some(isWholeArgument)) return arg
		const skip = new Set(held.map(firstKeyOf))
		return plainCopy({ value: arg, skip, copies: new Map() })
	})
	const wire = toWireValues({
		values: places.map(function valueOfPlace(place) {
			return valueAt({ args, place })
		}),
	})
	return {
		args: withValuesAt({ args: plainArgs, places, values: wire.values }),
		standIns: wire.standIns,
	}
}

/** The arguments back, each stand-in rebuilt at its place. */
export function fromWireArgs(params: {
	args: readonly unknown[]
	places: readonly WireJsonPlace[]
	standIns: WireStandIn[]
}): unknown[] {
	const { args, places, standIns } = params
	if (standIns.length === 0) return [...args]
	const values = fromWireValues({
		values: places.map(function valueOfPlace(place) {
			return valueAt({ args, place })
		}),
		standIns,
	})
	return withValuesAt({ args, places, values })
}

function valueAt(params: { args: readonly unknown[]; place: WireJsonPlace }): unknown {
	const { args, place } = params
	let value = args[place.argument]
	for (const key of place.path ?? []) {
		if (value === undefined || value === null) return undefined
		value = (value as Record<string, unknown>)[key]
	}
	return value
}

/** The arguments with `values` at their places: the objects on a place's path copied, never changed. */
function withValuesAt(params: {
	args: readonly unknown[]
	places: readonly WireJsonPlace[]
	values: unknown[]
}): unknown[] {
	const { args, places, values } = params
	const placed = [...args]
	places.forEach(function placeValue(place, index) {
		placed[place.argument] = withValueAtPath({
			holder: placed[place.argument],
			path: place.path ?? [],
			value: values[index],
		})
	})
	return placed
}

/** `holder` with `value` at `path`, each object on the way copied; a path through nothing is left as it is. */
function withValueAtPath(params: {
	holder: unknown
	path: readonly string[]
	value: unknown
}): unknown {
	const { holder, path, value } = params
	if (path.length === 0) return value
	if (holder === undefined || holder === null) return holder
	const [key, ...rest] = path as [string, ...string[]]
	const held = holder as Record<string, unknown>
	return { ...held, [key]: withValueAtPath({ holder: held[key], path: rest, value }) }
}

/**
 * A value the store does not check, as a port can carry it: plain arrays and objects copied (a proxy
 * over them - a reactive object - read as what it reads as), every other value kept as it is (a
 * `File`, a `Blob`, a string); a cycle kept. `skip` names the top fields copied elsewhere.
 */
function plainCopy(params: {
	value: unknown
	skip?: Set<string>
	copies: Map<object, unknown>
}): unknown {
	const { value, skip, copies } = params
	if (typeof value !== 'object' || value === null) return value
	if (copies.has(value)) return copies.get(value)
	const isArray = Array.isArray(value)
	if (
		!isRootPrototype({
			prototype: Object.getPrototypeOf(value),
			name: isArray ? 'Array' : 'Object',
		})
	) {
		return value
	}
	if (isArray) {
		const copy: unknown[] = []
		copies.set(value, copy)
		for (const member of value) copy.push(plainCopy({ value: member, copies }))
		return copy
	}
	const copy: Record<string, unknown> = {}
	copies.set(value, copy)
	for (const key of Object.keys(value)) {
		const member = (value as Record<string, unknown>)[key]
		Object.defineProperty(copy, key, {
			value: skip?.has(key) ? member : plainCopy({ value: member, copies }),
			writable: true,
			enumerable: true,
			configurable: true,
		})
	}
	return copy
}

function isWholeArgument(place: WireJsonPlace): boolean {
	return (place.path ?? []).length === 0
}

function firstKeyOf(place: WireJsonPlace): string {
	return place.path![0]!
}
