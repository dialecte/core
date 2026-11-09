import { ENGINE_WORKER_CASE_TIMEOUT_MS } from '../sqlite/runtime/runtime.fixtures.constants'
import { FULL_TABLE_VARIABLE, WORKER_LEG_PREFIX } from './store-contract.constants'
import { createSqliteWorkerStoreFactory } from './store-contract.factories'
import { leftoverPoolsOf } from './store-contract.leftover-pools'
import { missingWireMembers } from './store-contract.missing-wire-members'
import { defineStoreContractLeg } from './store-contract.suite'

import { describe, expect, inject, it, vi } from 'vitest'

import type { EngineApi } from '../sqlite/served/engine.types'

// the leg spawns an engine worker per case: seconds apiece on a loaded machine
vi.setConfig({ testTimeout: ENGINE_WORKER_CASE_TIMEOUT_MS })

/** Every member of the engine the leg's cases called, noted as they run. */
const called = new Set<keyof EngineApi>()

defineStoreContractLeg({ factory: createSqliteWorkerStoreFactory({ called }), subset: 'transport' })

// after every case of the leg (the cases run in order): what the subset reached, what it left behind
describe('the worker leg, after its cases', () => {
	it('the full-table switch reaches this realm as the config set it (its value provided on a second channel)', () => {
		expect(import.meta.env.STORE_CONTRACT_FULL_TABLE).toBe(inject(FULL_TABLE_VARIABLE))
	})

	it('every member of the engine wire was called by a case: the subset leaves no part of the port untried', () => {
		expect(missingWireMembers({ called })).toEqual([])
	})

	it('every store a case opened is destroyed after it: no pool of this leg left on the private file system', async () => {
		await expect(leftoverPoolsOf({ prefix: WORKER_LEG_PREFIX })).resolves.toEqual([])
	})
})
