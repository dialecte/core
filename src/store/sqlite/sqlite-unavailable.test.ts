import { listProjects } from './list-projects'

import { describe, expect, it } from 'vitest'

import { createProjectFactory } from '@/dialecte'
import { createCountingDialecte, ENGINE_URL } from '@/dialecte/create-project-factory.fixtures'
import { toDialecteError } from '@/errors'
import { resolveStore } from '@/store/resolve-store'
import { withSqliteStorage } from '@/store/sqlite-storage.fixtures'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

/** A dialecte's runtime as its factory gives it to the store: its configs, its version and its engine's address. */
const SQLITE_RUNTIME = {
	configs: { default: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig },
	defaultConfigKey: 'default',
	dialecteVersion: '0.0.0',
	engineUrl: ENGINE_URL,
}

function uniqueName(): string {
	return `sqlite-${crypto.randomUUID()}`
}

/**
 * What SQLite storage answers where the realm can run no engine - no worker, no private file system (Node). In a
 * browser the same calls open a project (an engine started) or read the private file system: the browser suites of
 * the SQLite connector and of the listing cover them.
 */
describe('SQLite storage where the realm can run no engine (node)', () => {
	type TestCase = { call: () => Promise<unknown> }
	const testCases: Record<string, TestCase> = {
		'a project made by the factory, opened → STORE_UNAVAILABLE': {
			call: function openFromFactory() {
				const factory = createProjectFactory({
					dialecte: createCountingDialecte(),
					engineUrl: ENGINE_URL,
				})
				return factory({ storage: { type: 'sqlite' } }).open(uniqueName())
			},
		},
		'a project destroyed by name through the factory → STORE_UNAVAILABLE': {
			call: function destroyByName() {
				const factory = createProjectFactory({
					dialecte: createCountingDialecte(),
					engineUrl: ENGINE_URL,
				})
				return factory.destroyProject({ name: uniqueName() })
			},
		},
		'the store resolveStore builds, opened → STORE_UNAVAILABLE': {
			call: function openResolved() {
				return resolveStore({
					name: uniqueName(),
					storage: { type: 'sqlite' },
					runtime: SQLITE_RUNTIME,
					dialecteId: 'core/test',
				}).open()
			},
		},
		'the projects listed → STORE_UNAVAILABLE': {
			call: function listed() {
				return listProjects()
			},
		},
	}
	for (const [description, { call }] of Object.entries(testCases)) {
		it(description, async () => {
			withSqliteStorage()
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
