import Dexie from 'dexie'

import type { AnyDialecteConfig, ElementsOf, RawRecord } from '@/types'
import type { EntityTable } from 'dexie'

export type DatabaseInstance<GenericConfig extends AnyDialecteConfig> = Dexie & {
	[tableName: string]: EntityTable<RawRecord<GenericConfig, ElementsOf<GenericConfig>>, 'id'>
}

export type AnyDatabaseInstance = DatabaseInstance<AnyDialecteConfig>
