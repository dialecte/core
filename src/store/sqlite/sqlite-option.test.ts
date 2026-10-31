import { createLazySqliteConnector } from './sqlite-option'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'

import type { EngineConnector, EngineLink } from '../engine/engine-store.types'
import type { SqliteConnectorModule, SqliteConnectorParams } from './sqlite-option.types'

const PARAMS: SqliteConnectorParams = {
	name: 'lazy',
	dialecteId: 'core/test',
	dialecteVersion: '0.0.0',
	engineUrl: 'https://dialecte.test/engine.js',
}

const LINK = {} as EngineLink

/** A loader failing its first `failures` loads, then giving a connector that records what it was asked. */
function flakyLoader(params: { failures: number }): {
	load: () => Promise<SqliteConnectorModule>
	loads: () => number
	asked: string[]
} {
	let loads = 0
	const asked: string[] = []
	const connector: EngineConnector = {
		connect: async function connect() {
			asked.push('connect')
			return LINK
		},
		destroy: async function destroy() {
			asked.push('destroy')
		},
	}
	return {
		asked,
		loads: function loadCount() {
			return loads
		},
		load: async function load() {
			loads += 1
			if (loads <= params.failures)
				throw new TypeError('Failed to fetch dynamically imported module')
			return {
				createSqliteConnector: function made(made: SqliteConnectorParams) {
					expect(made).toEqual(PARAMS)
					return connector
				},
			}
		},
	}
}

async function keyOf(params: { action: Promise<unknown> }): Promise<string | undefined> {
	return params.action.then(
		function answered() {
			return undefined
		},
		function refused(thrown: unknown) {
			return toDialecteError(thrown)?.key
		},
	)
}

describe('the sqlite connector, loaded at its first use', () => {
	it('its code cannot be loaded → connect and destroy refused STORE_CONNECTION_FAILED', async () => {
		const loader = flakyLoader({ failures: 2 })
		const connector = createLazySqliteConnector({ connector: PARAMS, load: loader.load })
		expect(await keyOf({ action: connector.connect() })).toBe('STORE_CONNECTION_FAILED')
		expect(await keyOf({ action: connector.destroy() })).toBe('STORE_CONNECTION_FAILED')
		expect(loader.asked).toEqual([])
	})

	it('its code failed to load once → the next call loads it again and goes through', async () => {
		const loader = flakyLoader({ failures: 1 })
		const connector = createLazySqliteConnector({ connector: PARAMS, load: loader.load })
		expect(await keyOf({ action: connector.connect() })).toBe('STORE_CONNECTION_FAILED')
		expect(await connector.connect()).toBe(LINK)
		await connector.destroy()
		expect(loader.asked).toEqual(['connect', 'destroy'])
		expect(loader.loads()).toBe(2)
	})

	it('nothing asked of it → nothing loaded', () => {
		const loader = flakyLoader({ failures: 0 })
		createLazySqliteConnector({ connector: PARAMS, load: loader.load })
		expect(loader.loads()).toBe(0)
	})
})
