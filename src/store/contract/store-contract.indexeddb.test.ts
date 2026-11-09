import { IN_REALM_CASE_TIMEOUT_MS } from './store-contract.constants'
import { dexieStoreFactory } from './store-contract.factories'
import { defineStoreContractLeg } from './store-contract.suite'

import { vi } from 'vitest'

vi.setConfig({ testTimeout: IN_REALM_CASE_TIMEOUT_MS })

defineStoreContractLeg({ factory: dexieStoreFactory, subset: 'full' })
