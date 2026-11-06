import type { Store } from '@/store/store.types'

/** The stores `createTestContext` opened by name: connections of their own, closed by `closeTestContexts`. */
export const OPENED_CONTEXT_STORES = new Set<Store>()
