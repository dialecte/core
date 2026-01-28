import Dexie from 'dexie'

import type { DatabaseInstance } from './types'
import type { AnyDialecteConfig } from '@/types'

export async function createDatabaseInstance<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
	createRootIfEmpty?: boolean
}): Promise<DatabaseInstance<GenericConfig>> {
	const { databaseName, dialecteConfig, createRootIfEmpty = false } = params

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

	if (createRootIfEmpty)
		await ensureRootElementExists({
			databaseInstance: databaseInstance as DatabaseInstance<GenericConfig>,
			dialecteConfig,
		})

	return databaseInstance as DatabaseInstance<GenericConfig>
}

async function ensureRootElementExists<GenericConfig extends AnyDialecteConfig>(params: {
	databaseInstance: DatabaseInstance<GenericConfig>
	dialecteConfig: GenericConfig
}): Promise<void> {
	const { databaseInstance, dialecteConfig } = params
	const tableName = dialecteConfig.database.tables.xmlElements.name
	const rootElementName = dialecteConfig.rootElementName

	await databaseInstance.open()
	const table = databaseInstance.table(tableName)

	const rootExists = await table.where({ tagName: rootElementName }).count()

	const attributes = dialecteConfig.definition[rootElementName].attributes.details

	let rootAttributes = []

	for (const [attributeName, attribute] of Object.entries(attributes)) {
		if (attribute.required && attribute.default) {
			rootAttributes.push({
				name: attributeName,
				value: attribute.default.toString(),
				namespace: attribute.namespace ?? undefined,
			})
		}
	}

	if (rootExists === 0) {
		await table.add({
			id: crypto.randomUUID(),
			tagName: rootElementName,
			namespace: dialecteConfig.definition[rootElementName].namespace,
			attributes: rootAttributes,
			parent: null,
			children: [],
		})
	}
}
