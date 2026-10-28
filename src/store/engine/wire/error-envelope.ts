import { WIRE_CAUSE_DEPTH } from './wire.constants'

import { toDialecteError } from '@/errors'

import type { DialecteErrorData, ThrownData } from './wire.types'
import type { DialecteError } from '@/errors'

/**
 * A thrown value as data a port carries (structured clone), causes included down to
 * `WIRE_CAUSE_DEPTH`: no transfer handler of Comlink's is touched, so no other user of it changes.
 */
export function toThrownData(params: { thrown: unknown }): ThrownData {
	return thrownDataAt({ thrown: params.thrown, depth: 0 })
}

/**
 * The thrown value back from its data: a structured error rebuilt as `createDialecteError` builds
 * it (an `Error` whose `cause` is the record), so `toDialecteError` and `isKnownDialecteError` match
 * it; any other `Error` as a plain `Error` of the same name.
 */
export function fromThrownData(params: { data: ThrownData }): unknown {
	const { data } = params
	switch (data.kind) {
		case 'dialecte': {
			const { cause, ...record } = data.error
			const error = new Error(data.message)
			if (data.stack !== undefined) error.stack = data.stack
			const rebuilt: DialecteError = { ...record }
			if (cause) rebuilt.cause = asError({ value: fromThrownData({ data: cause }) })
			error.cause = rebuilt
			return error
		}
		case 'error': {
			const error = new Error(data.message)
			error.name = data.name
			if (data.stack !== undefined) error.stack = data.stack
			if (data.cause) error.cause = fromThrownData({ data: data.cause })
			return error
		}
		case 'value':
			return data.value
	}
}

function thrownDataAt(params: { thrown: unknown; depth: number }): ThrownData {
	const { thrown, depth } = params
	const structured = toDialecteError(thrown)
	if (structured && thrown instanceof Error) {
		const { cause, meta, ...record } = structured
		const error: DialecteErrorData = { ...record }
		if (meta !== undefined) error.meta = cloneSafe({ value: meta }) as Record<string, unknown>
		if (cause !== undefined && depth < WIRE_CAUSE_DEPTH) {
			error.cause = thrownDataAt({ thrown: cause, depth: depth + 1 })
		}
		return { kind: 'dialecte', message: thrown.message, stack: thrown.stack, error }
	}
	if (thrown instanceof Error) {
		const data: ThrownData = {
			kind: 'error',
			name: thrown.name,
			message: thrown.message,
			stack: thrown.stack,
		}
		if (thrown.cause !== undefined && depth < WIRE_CAUSE_DEPTH) {
			data.cause = thrownDataAt({ thrown: thrown.cause, depth: depth + 1 })
		}
		return data
	}
	return { kind: 'value', value: cloneSafe({ value: thrown }) }
}

/**
 * A value a port carries: as it is when it clones; else a plain array or object rebuilt member by
 * member, each member that does not clone as its text (a function, a symbol); a cycle as its text.
 */
function cloneSafe(params: { value: unknown; ancestors?: Set<object> }): unknown {
	const { value, ancestors = new Set<object>() } = params
	if (clones({ value })) return value
	if (typeof value !== 'object' || value === null || ancestors.has(value)) return String(value)
	const prototype: unknown = Object.getPrototypeOf(value)
	const isArray = Array.isArray(value)
	if (prototype !== (isArray ? Array.prototype : Object.prototype) && prototype !== null) {
		return String(value)
	}
	ancestors.add(value)
	const safe = isArray
		? value.map(function memberSafe(member: unknown) {
				return cloneSafe({ value: member, ancestors })
			})
		: Object.fromEntries(
				Object.entries(value).map(function fieldSafe([key, member]) {
					return [key, cloneSafe({ value: member, ancestors })]
				}),
			)
	ancestors.delete(value)
	return safe
}

function clones(params: { value: unknown }): boolean {
	try {
		structuredClone(params.value)
		return true
	} catch {
		return false
	}
}

/** A cause as the record's type holds it: an `Error`, the value as its message otherwise. */
function asError(params: { value: unknown }): Error {
	const { value } = params
	return value instanceof Error ? value : new Error(String(value))
}
