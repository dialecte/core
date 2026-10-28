import { fromThrownData, toThrownData } from './error-envelope'
import { WIRE_CAUSE_DEPTH } from './wire.constants'

import { describe, expect, it } from 'vitest'

import { createDialecteError, isKnownDialecteError, toDialecteError } from '@/errors'

/** A thrown value as the other side of a port receives it. */
function acrossPort(thrown: unknown): unknown {
	return fromThrownData({ data: structuredClone(toThrownData({ thrown })) })
}

/** An `Error` holding `depth` causes, each an `Error` naming its level. */
function causeChain(params: { depth: number }): Error {
	let error = new Error(`level ${params.depth}`)
	for (let level = params.depth - 1; level >= 0; level -= 1) {
		error = new Error(`level ${level}`, { cause: error })
	}
	return error
}

/** The messages of an error's causes, outermost first. */
function causeMessages(params: { error: unknown }): string[] {
	const messages: string[] = []
	let current = params.error instanceof Error ? params.error.cause : undefined
	while (current instanceof Error) {
		messages.push(current.message)
		current = current.cause
	}
	return messages
}

describe('a thrown value carried across a port as data', () => {
	it('a structured error with a ref, a meta and a SQLite failure as cause → the same structured error: key, code, message, detail, method, ref, meta, a known key, its cause an Error', () => {
		const sqliteFailure = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: xel_1.id')
		const thrown = createDialecteError('STORE_DUPLICATE_ID', {
			detail: 'Document "doc-1" already holds r1',
			ref: { tagName: 'B', id: 'r1' },
			meta: { documentId: 'doc-1', recordIds: ['r1', ['nested']] },
			cause: sqliteFailure,
		})
		const sent = toDialecteError(thrown)
		const received = acrossPort(thrown)
		const error = toDialecteError(received)
		expect(received).toBeInstanceOf(Error)
		expect((received as Error).message).toBe((thrown as Error).message)
		expect(error).toEqual({ ...sent, cause: expect.any(Error) })
		expect(error && isKnownDialecteError(error, { catalogues: [] })).toBe(true)
		expect(error?.cause?.message).toBe(sqliteFailure.message)
		expect((received as Error).stack).toBe((thrown as Error).stack)
	})

	it('a structured error caused by another structured error → both rebuilt, each a structured error', () => {
		const inner = createDialecteError('STORE_COMMIT_FAILED', { detail: 'inner', meta: { at: 1 } })
		const thrown = createDialecteError('IMPORT_FAILED', { detail: 'outer', cause: inner })
		const error = toDialecteError(acrossPort(thrown))
		expect(error?.key).toBe('IMPORT_FAILED')
		expect(toDialecteError(error?.cause)).toEqual({
			...toDialecteError(inner),
			cause: undefined,
		})
	})

	it(`a cause chain deeper than ${WIRE_CAUSE_DEPTH} levels → kept down to that depth`, () => {
		const received = acrossPort(causeChain({ depth: WIRE_CAUSE_DEPTH + 3 }))
		expect(causeMessages({ error: received })).toEqual(
			Array.from({ length: WIRE_CAUSE_DEPTH }, (_, index) => `level ${index + 1}`),
		)
	})

	it('a structured error whose meta holds a function → each function as its text, every other member kept as it is (a Date, NaN, a cycle)', () => {
		function hook(): void {}
		const cyclic: Record<string, unknown> = { name: 'cyclic' }
		cyclic.self = cyclic
		const at = new Date(0)
		const thrown = createDialecteError('ASSERTION_FAILED', {
			detail: 'a hook',
			meta: { documentId: 'doc-1', at, nested: { hook, kept: [1, Number.NaN] }, cyclic, hook },
		})
		const meta = toDialecteError(acrossPort(thrown))?.meta
		expect(meta).toEqual({
			documentId: 'doc-1',
			at,
			nested: { hook: String(hook), kept: [1, Number.NaN] },
			cyclic,
			hook: String(hook),
		})
	})

	it('a TypeError holding a cause → a plain Error named TypeError, its message, its cause; no structured error', () => {
		const thrown = new TypeError('record.namespace is undefined', {
			cause: new RangeError('inner'),
		})
		const received = acrossPort(thrown)
		expect(received).toBeInstanceOf(Error)
		expect((received as Error).name).toBe('TypeError')
		expect((received as Error).message).toBe('record.namespace is undefined')
		expect(((received as Error).cause as Error).name).toBe('RangeError')
		expect(toDialecteError(received)).toBeUndefined()
	})

	type ValueCase = { thrown: unknown; expected: unknown }
	const valueCases: Record<string, ValueCase> = {
		'a string thrown → the string': { thrown: 'refused', expected: 'refused' },
		'a plain object thrown → the object': {
			thrown: { reason: 'refused', at: [1] },
			expected: { reason: 'refused', at: [1] },
		},
		'a value no port carries (a function) → its text': {
			thrown: function refuse() {},
			expected: String(function refuse() {}),
		},
	}
	for (const [description, { thrown, expected }] of Object.entries(valueCases)) {
		it(description, () => {
			expect(acrossPort(thrown)).toEqual(expected)
		})
	}
})
