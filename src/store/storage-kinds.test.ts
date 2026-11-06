import { resolveStore } from './resolve-store'
import { SQLITE_STORAGE_KIND } from './sqlite/sqlite-storage-kind'
import { registerStorageKind, replaceStorageKind } from './storage-kinds'
import {
	answerOf,
	fakeKindOf,
	fakeStorageOf,
	fakeStore,
	outcomeOf,
	refusalOf,
	uniqueFakeType,
} from './storage-kinds.fixtures'

import { describe, expect, it, onTestFinished } from 'vitest'

import { DexieStore, InMemoryStore } from '@/store'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { StorageKind } from './storage-kinds.types'
import type { StorageParam } from '@/project/types'
import type { Store } from '@/store'
import type { AnyDialecteConfig } from '@/types'

const RUNTIME = {
	configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
	defaultConfigKey: 'default',
}

/** Registers a kind of a type no case shares, then the kinds given; the type is free again when the case ends. */
function registerInOrder(params: { type: string; kinds: StorageKind[] }): void {
	const { type, kinds } = params
	onTestFinished(replaceStorageKind({ type, kind: undefined }))
	for (const kind of kinds) registerStorageKind({ type: type as 'sqlite', kind: kind as never })
}

describe('registerStorageKind', () => {
	it('a second registration of a type, with the same id (a module evaluated twice) → nothing: the first storeOf still answers', () => {
		const type = uniqueFakeType()
		const first = fakeKindOf({ id: 'fake@1' })
		const second = fakeKindOf({ id: 'fake@1' })
		const outcome = outcomeOf(function resolveAfterTwoRegistrations() {
			registerInOrder({ type, kinds: [first.kind, second.kind] })
			return resolveStore({
				name: 'registered-twice',
				storage: fakeStorageOf({ type }),
				runtime: RUNTIME,
			})
		})

		expect(answerOf(outcome)).toBe(first.built)
		expect(second.storeOf).not.toHaveBeenCalled()
	})

	it('a second registration of a type, with another id → STORE_KIND_TAKEN naming both ids, the first kind kept', () => {
		const type = uniqueFakeType()
		const first = fakeKindOf({ id: 'fake@1' })
		const second = fakeKindOf({ id: 'other@2' })
		const registration = outcomeOf(function registerTwoKinds() {
			registerInOrder({ type, kinds: [first.kind, second.kind] })
		})
		const resolution = outcomeOf(function resolveAfterRefusal() {
			return resolveStore({
				name: 'registered-taken',
				storage: fakeStorageOf({ type }),
				runtime: RUNTIME,
			})
		})

		const refusal = refusalOf(registration)
		expect({ key: refusal?.key, meta: refusal?.meta }).toEqual({
			key: 'STORE_KIND_TAKEN',
			meta: { type, registered: 'fake@1', asked: 'other@2' },
		})
		expect(answerOf(resolution)).toBe(first.built)
		expect(second.storeOf).not.toHaveBeenCalled()
	})

	it('a sqlite kind of the same id already on the realm (another copy, another SQLite version), then the sqlite kind of this copy → nothing thrown: the first kind still answers', () => {
		const first = fakeKindOf({ id: '@dialecte/core/sqlite' })
		const outcome = outcomeOf(function registerAfterAnotherCopy() {
			onTestFinished(replaceStorageKind({ type: 'sqlite', kind: first.kind as never }))
			registerStorageKind({ type: 'sqlite', kind: SQLITE_STORAGE_KIND })
			return resolveStore({
				name: 'registered-by-another-copy',
				storage: fakeStorageOf({ type: 'sqlite' }),
				runtime: RUNTIME,
			})
		})

		expect(answerOf(outcome)).toBe(first.built)
	})

	describe('a built-in type', () => {
		const custom = fakeStore()
		const builtIns: Record<string, { storage: StorageParam; served: (store: Store) => boolean }> = {
			local: { storage: { type: 'local' }, served: (store) => store instanceof DexieStore },
			inMemory: {
				storage: { type: 'inMemory' },
				served: (store) => store instanceof InMemoryStore,
			},
			custom: { storage: { type: 'custom', store: custom }, served: (store) => store === custom },
		}
		for (const [type, { storage, served }] of Object.entries(builtIns)) {
			it(`${type} → ASSERTION_FAILED: core serves it, no registration takes its place`, () => {
				const { kind } = fakeKindOf({ id: 'fake@1' })
				// the type refuses it first: the cast is the test's, to reach the check behind the type
				const register = registerStorageKind as unknown as (params: {
					type: string
					kind: StorageKind
				}) => void
				const outcome = outcomeOf(function registerBuiltIn() {
					register({ type, kind })
				})

				const after = outcomeOf(function resolveBuiltIn() {
					return resolveStore({ name: 'built-in', storage, runtime: RUNTIME })
				})
				const store = answerOf(after)

				expect(refusalOf(outcome)?.key).toBe('ASSERTION_FAILED')
				expect(store !== undefined && served(store)).toBe(true)
			})
		}
	})
})
