import { assert } from '@/helpers'

import { createDatabaseInstance } from '../database'

import { fromElement, fromRoot } from './entrypoints'
import { getState } from './state'

import type { DialecteCore, FromElementParams } from './types'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

export async function createDialecte<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
}): Promise<DialecteCore<GenericConfig>> {
	const { databaseName, dialecteConfig } = params

	assert(databaseName, 'Database name is required to create SDK')

	const databaseInstance = await createDatabaseInstance({
		databaseName,
		dialecteConfig,
		createRootIfEmpty: true,
	})

	return {
		getState,
		getDatabaseInstance: () => databaseInstance,
		fromRoot: () => fromRoot({ dialecteConfig, databaseInstance }),
		fromElement: <GenericElement extends ElementsOf<GenericConfig>>(
			params: FromElementParams<GenericConfig, GenericElement>,
		) =>
			fromElement<GenericConfig, GenericElement>({
				dialecteConfig,
				databaseInstance,
				...params,
			}),
	}
}
