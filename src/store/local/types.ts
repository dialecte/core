import { RecordSchema } from '../store.types'

export type DexieStoreOptions = {
	/** Backend-agnostic record schema. Comes from dialecteConfig.recordSchema */
	recordSchema?: RecordSchema
}
