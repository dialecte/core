import { vi } from 'vitest'

import { toDialecteError } from '@/errors'

import type { StorageKind } from './storage-kinds.types'
import type { StorageParam } from '@/project/types'
import type { Store } from '@/store'

/** What a call answered, or what it threw: a refusal, or a stub, then fails the case on its assertion. */
export type Outcome<GenericAnswer> = { answered: GenericAnswer } | { thrown: unknown }

/** The call's answer, or what it threw. */
export function outcomeOf<GenericAnswer>(act: () => GenericAnswer): Outcome<GenericAnswer> {
	try {
		return { answered: act() }
	} catch (thrown) {
		return { thrown }
	}
}

/** The answer of an outcome; `undefined` when the call threw. */
export function answerOf<GenericAnswer>(
	outcome: Outcome<GenericAnswer>,
): GenericAnswer | undefined {
	return 'answered' in outcome ? outcome.answered : undefined
}

/** The structured error an outcome threw; `undefined` when the call answered or threw another error. */
export function refusalOf(outcome: Outcome<unknown>) {
	return 'thrown' in outcome ? toDialecteError(outcome.thrown) : undefined
}

/** A storage type no kind registered: every case of a file takes its own. */
export function uniqueFakeType(): string {
	return `fake-${crypto.randomUUID()}`
}

/** A storage param of a type a test made up: the type system only knows the types of `StorageKinds`. */
export function fakeStorageOf(params: { type: string }): StorageParam {
	return params as unknown as StorageParam
}

/** A store that answers nothing: what a fake kind builds, told apart by identity. */
export function fakeStore(): Store {
	return { open: vi.fn() } as unknown as Store
}

/** A kind of that id whose `storeOf` builds `built`, spied. */
export function fakeKindOf(params: { id: string; built?: Store; testStore?: Store }) {
	const { id, built = fakeStore(), testStore } = params
	const storeOf = vi.fn<StorageKind['storeOf']>(function builtStore() {
		return built
	})
	const testStoreOf = vi.fn<NonNullable<StorageKind['testStoreOf']>>(
		async function builtTestStore() {
			return testStore as Store
		},
	)
	const kind: StorageKind = testStore ? { id, storeOf, testStoreOf } : { id, storeOf }
	return { kind, storeOf, testStoreOf, built, testStore }
}
