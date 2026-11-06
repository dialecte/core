import { registeredSqliteEngine, replaceSqliteEngine } from './sqlite-engine-registration'

import { describe, expect, it, onTestFinished } from 'vitest'

import '@/sqlite'
import { resolveStore } from '@/store/resolve-store'
import { replaceStorageKind } from '@/store/storage-kinds'
import { answerOf, fakeKindOf, outcomeOf, refusalOf } from '@/store/storage-kinds.fixtures'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { SqliteEngineRegistration } from './sqlite-storage.types'
import type { AnyDialecteConfig } from '@/types'

// The `sqlite` kind lives in the registry of storage kinds (`storage-kinds.test.ts` pins first-wins, the refusals and
// the lookup); importing `@dialecte/core/sqlite` registers it, pinned here, and by the `node-sqlite` project.

const RUNTIME = {
	configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
	defaultConfigKey: 'default',
}

const ENGINE: SqliteEngineRegistration = {
	url: 'https://dialecte.test/engine.worker.js',
	dialectes: [{ id: 'core/test', version: '0.0.0' }],
}

describe('the sqlite storage kind', () => {
	it('replaced for a case → the replacement answers', () => {
		const { kind, built } = fakeKindOf({ id: 'fake-sqlite@1' })
		const replaced = outcomeOf(function resolveReplaced() {
			onTestFinished(replaceStorageKind({ type: 'sqlite', kind }))
			return resolveStore({
				name: 'sqlite-kind',
				storage: { type: 'sqlite' },
				runtime: RUNTIME,
				dialecteId: 'core/test',
			})
		})

		expect(answerOf(replaced)).toBe(built)
	})

	it('replaced, then restored → the kind the entry registered answers again', () => {
		const { kind } = fakeKindOf({ id: 'fake-sqlite@1' })
		const restored = outcomeOf(function resolveRestored() {
			const restore = replaceStorageKind({ type: 'sqlite', kind })
			restore()
			// a project made by no dialecte: the sqlite kind itself refuses it, the registry does not
			return resolveStore({ name: 'sqlite-kind', storage: { type: 'sqlite' }, runtime: RUNTIME })
		})

		expect(refusalOf(restored)?.key).toBe('PROJECT_ENGINE_NOT_DECLARED')
	})
})

describe('the engine registration on its own key of the realm', () => {
	it('replaced for a case, then restored → found as put, then as it was (none)', () => {
		const outcome = outcomeOf(function replaceAndRestore() {
			const restore = replaceSqliteEngine({ engine: ENGINE })
			const during = registeredSqliteEngine()
			restore()
			return { during, after: registeredSqliteEngine() }
		})

		expect(answerOf(outcome)).toEqual({ during: ENGINE, after: undefined })
	})
})
