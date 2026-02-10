import Dexie from 'dexie'

import type { AnyDialecteConfig, ElementsOf } from '../types/dialecte-config'
import type { RawRecord } from '../types/records'
import type { EntityTable } from 'dexie'

export type DatabaseInstance<GenericConfig extends AnyDialecteConfig> = Dexie & {
	[tableName: string]: EntityTable<RawRecord<GenericConfig, ElementsOf<GenericConfig>>, 'id'>
}

export type AnyDatabaseInstance = DatabaseInstance<AnyDialecteConfig>
