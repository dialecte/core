import Dexie from 'dexie'

import type { DatabaseInstance } from './types'
import type { AnyDialecteConfig } from '@/types'

export function createDatabaseInstance<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
}): DatabaseInstance<GenericConfig> {
	const { databaseName, dialecteConfig } = params

	const { xmlElements, additionalTables } = dialecteConfig.database.tables

	const databaseInstance = new Dexie(databaseName)

	const stores: Record<string, string> = {
		[xmlElements.name]: xmlElements.schema,
	}

	if (additionalTables) {
		for (const [tableName, tableConfig] of Object.entries(additionalTables)) {
			stores[tableName] = tableConfig.schema
		}
	}

	databaseInstance.version(1).stores(stores)

	return databaseInstance as DatabaseInstance<GenericConfig>
}
