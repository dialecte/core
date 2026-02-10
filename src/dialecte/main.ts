import { createDatabaseInstance } from '../database'
import { fromElement, fromRoot } from './entrypoints'
import { getState } from './state'

import { assert } from '@/helpers'

import type { DialecteCore, FromElementParams } from './types'
import type { AnyDialecteConfig, ElementsOf, ExtensionRegistry } from '@/types'

export async function createDialecte<
	GenericConfig extends AnyDialecteConfig,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig>,
>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
	extensions: GenericExtensionRegistry
}): Promise<DialecteCore<GenericConfig, GenericExtensionRegistry>> {
	const { databaseName, dialecteConfig, extensions } = params

	assert(databaseName, 'Database name is required to create SDK')

	const databaseInstance = await createDatabaseInstance({
		databaseName,
		dialecteConfig,
		createRootIfEmpty: true,
	})

	return {
		getState,
		getDatabaseInstance: () => databaseInstance,
		fromRoot: () => fromRoot({ dialecteConfig, databaseInstance, extensions }),
		fromElement: <GenericElement extends ElementsOf<GenericConfig>>(
			params: FromElementParams<GenericConfig, GenericElement>,
		) =>
			fromElement<GenericConfig, GenericElement, GenericExtensionRegistry>({
				dialecteConfig,
				databaseInstance,
				extensions,
				...params,
			}),
	}
}
