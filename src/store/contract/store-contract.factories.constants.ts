import {
	canRunEngineWorker,
	dexieStoreFactory,
	inMemoryStoreFactory,
	sqliteHubStoreFactory,
	sqliteInProcessStoreFactory,
	sqliteWorkerStoreFactory,
} from './store-contract.factories'

import type { StoreContractFactory } from './store-contract.types'

/** The stores the contract runs over today; a new kind of store joins by adding its factory here. */
export const STORE_CONTRACT_FACTORIES: StoreContractFactory[] = [
	inMemoryStoreFactory,
	dexieStoreFactory,
	sqliteInProcessStoreFactory,
	...(canRunEngineWorker() ? [sqliteWorkerStoreFactory, sqliteHubStoreFactory] : []),
]
