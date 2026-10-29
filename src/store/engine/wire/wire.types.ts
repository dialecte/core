import type { DialecteError } from '@/errors'

/**
 * A thrown value as a port carries it: a structured error with its record, any other `Error` with its
 * name, or any other value as it clones (its text when it cannot).
 */
export type ThrownData =
	| { kind: 'dialecte'; message: string; stack?: string; error: DialecteErrorData }
	| { kind: 'error'; name: string; message: string; stack?: string; cause?: ThrownData }
	| { kind: 'value'; value: unknown }

/** A structured error's record as a port carries it: its cause as data too. */
export type DialecteErrorData = Omit<DialecteError, 'cause'> & { cause?: ThrownData }

/** What a value that would not cross a port as it is stands for: the store's check refuses its stand-in as it. */
export type WireStandInKind =
	| 'function'
	| 'symbol'
	| 'instance'
	| 'raw-json'
	| 'to-json'
	| 'throwing-read'
	| 'throwing-inspection'

/**
 * A value of an argument, at `path` under it, left out of the copy and rebuilt on the other side:
 * `name` the class of an instance, `text` a raw JSON value's text, `message` what reading or looking
 * into it threw.
 */
export type WireStandIn = {
	index: number
	path: (string | number)[]
	kind: WireStandInKind
	name?: string
	text?: string
	message?: string
}

/** The values of a call's arguments as a port carries them: plain data, and the stand-ins to rebuild. */
export type WireValues = {
	values: unknown[]
	standIns: WireStandIn[]
}

/**
 * Where the copy is: the argument, the path under it (one stack, copied only into a stand-in), the
 * containers above (their copies by original), the stand-ins named so far.
 */
export type WireCopyStep = {
	index: number
	path: (string | number)[]
	ancestors: Map<object, unknown>
	standIns: WireStandIn[]
}

/**
 * Where an argument of a call holds a value the store's JSON check reads from its root (the depth it
 * counts starts there): the argument, or the value at a path of keys under it.
 */
export type WireJsonPlace = {
	argument: number
	path?: readonly string[]
}

/** How a member of the engine crosses a port. */
export type WireMemberSpec = {
	/** The place of its progress listener among its arguments (it crosses as a proxy of the caller's copy). */
	listener?: number
	/** The places of its arguments holding values the engine's JSON check reads (copied as plain data). */
	json?: readonly WireJsonPlace[]
	/** It is a write its caller identifies: its first argument carries the `writeId`. */
	identified?: boolean
	/** It is an export the caller can stop: its first argument carries the `exportId`. */
	abortable?: boolean
}

/** A call of a member of the engine as a port carries it. */
export type WireRequest = {
	member: string
	args: unknown[]
	standIns: WireStandIn[]
}

/** What the engine answers a call: its value, or what it threw as data. */
export type WireAnswer = { ok: true; value: unknown } | { ok: false; thrown: ThrownData }

/** What the engine exposes on a client's port: one member, every call through it. */
export type EngineWire = {
	call: (request: WireRequest, listener?: (...progress: unknown[]) => void) => Promise<WireAnswer>
}
