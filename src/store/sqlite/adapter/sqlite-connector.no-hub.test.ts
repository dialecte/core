import { TEST_ENGINE_URL } from '../runtime/runtime.fixtures'
import { refuseRealmStorage, restoreRealmStorage } from './realm-storage.fixtures'
import { createSqliteConnector } from './sqlite-connector'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE } from '@/test'

// before any hub is asked (this file's realm keeps no connection yet): no SharedWorker, the private file system refused
vi.stubGlobal('SharedWorker', undefined)
refuseRealmStorage()

afterAll(function restoreRealm() {
	vi.unstubAllGlobals()
	restoreRealmStorage()
})

function connector(): ReturnType<typeof createSqliteConnector> {
	return createSqliteConnector({
		name: `no-hub-${crypto.randomUUID()}`,
		dialecteId: TEST_DIALECTE.id,
		dialecteVersion: TEST_DIALECTE.version,
		engineUrl: TEST_ENGINE_URL,
	})
}

describe('a page with no hub whose private file system is refused', () => {
	type TestCase = { call: () => Promise<unknown> }
	const testCases: Record<string, TestCase> = {
		'a project connected → STORE_UNAVAILABLE': {
			call: function connect() {
				return connector().connect()
			},
		},
		'a project destroyed → STORE_UNAVAILABLE': {
			call: function destroy() {
				return connector().destroy()
			},
		},
	}
	for (const [description, { call }] of Object.entries(testCases)) {
		it(description, async () => {
			const key = await call().then(
				function answered() {
					return 'answered'
				},
				function refused(thrown: unknown) {
					return toDialecteError(thrown)?.key
				},
			)
			expect(key).toBe('STORE_UNAVAILABLE')
		})
	}
})
