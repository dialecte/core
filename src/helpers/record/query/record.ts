import { assert } from '@/helpers'

import { toChainRecord } from '../converter'

import type { DatabaseInstance } from '@/database'
import type {
	Operation,
	RawRecord,
	ElementsOf,
	AnyDialecteConfig,
	AnyElement,
	ChainRecord,
} from '@/types'

// Overload: type='raw' returns RawRecord
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends AnyElement,
>(params: {
	id: string
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type: 'raw'
}): Promise<RawRecord<GenericConfig, GenericElement> | undefined>

// Overload: type='chain' returns ChainRecord
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends AnyElement,
>(params: {
	id: string
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type: 'chain'
}): Promise<ChainRecord<GenericConfig, GenericElement> | undefined>

// Overload: type omitted defaults to 'raw'
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends AnyElement,
>(params: {
	id: string
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type?: undefined
}): Promise<RawRecord<GenericConfig, GenericElement> | undefined>

// Implementation
export async function getRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends AnyElement,
>(params: {
	id: string
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type?: 'raw' | 'chain'
}): Promise<
	ChainRecord<GenericConfig, GenericElement> | RawRecord<GenericConfig, GenericElement> | undefined
> {
	const { id, tagName, stagedOperations, dialecteConfig, databaseInstance, type = 'raw' } = params

	const stagedRecord = getLatestStagedRecord({
		stagedOperations,
		id,
		tagName,
		throwOnDeleted: false,
	})

	if (stagedRecord?.status === 'deleted') return undefined
	if (stagedRecord) {
		if (type === 'raw') return stagedRecord.record
		return toChainRecord({ record: stagedRecord.record, status: stagedRecord.status })
	}

	const elementsTableName = dialecteConfig.database.tables.xmlElements.name
	const record = await databaseInstance.table(elementsTableName).get(id)

	if (!record) return undefined

	assert(record.tagName === tagName, 'Element tagName mismatch')
	if (type === 'raw') return record
	return toChainRecord({ record })
}

// Overload: type='raw' returns RawRecord[]
export async function fetchRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type: 'raw'
}): Promise<RawRecord<GenericConfig, GenericElement>[]>

// Overload: type='chain' returns ChainRecord[]
export async function fetchRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type: 'chain'
}): Promise<ChainRecord<GenericConfig, GenericElement>[]>

// Overload: type omitted defaults to 'raw'
export async function fetchRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type?: undefined
}): Promise<RawRecord<GenericConfig, GenericElement>[]>

// Implementation
export async function fetchRecords<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	tagName: GenericElement
	stagedOperations: Operation<GenericConfig>[]
	dialecteConfig: GenericConfig
	databaseInstance: DatabaseInstance<GenericConfig>
	type?: 'raw' | 'chain'
}): Promise<
	RawRecord<GenericConfig, GenericElement>[] | ChainRecord<GenericConfig, GenericElement>[]
> {
	const { stagedOperations, tagName, dialecteConfig, databaseInstance, type = 'raw' } = params
	const elementsTableName = dialecteConfig.database.tables.xmlElements.name

	const dbRecords: RawRecord<GenericConfig, GenericElement>[] = await databaseInstance
		.table(elementsTableName)
		.where({ tagName })
		.toArray()
	const recordsById = new Map(
		dbRecords.map((record) => [record.id, type === 'raw' ? record : toChainRecord({ record })]),
	)

	for (const operation of stagedOperations) {
		const isNewOrUpdated = operation.status === 'created' || operation.status === 'updated'

		if (isNewOrUpdated && operation.newRecord.tagName === tagName) {
			if (type === 'chain') {
				recordsById.set(
					operation.newRecord.id,
					toChainRecord({ record: operation.newRecord, status: operation.status }) as ChainRecord<
						GenericConfig,
						GenericElement
					>,
				)
			} else {
				recordsById.set(
					operation.newRecord.id,
					operation.newRecord as RawRecord<GenericConfig, GenericElement>,
				)
			}
		}

		if (operation.status === 'deleted' && operation.oldRecord?.tagName === tagName) {
			recordsById.delete(operation.oldRecord.id)
		}
	}

	return Array.from(recordsById.values())
}

/**
 * Retrieves the latest staged record for a given element by id.
 * Throws if the element has been deleted in staged operations.
 * Searches operations in reverse order (most recent first).
 *
 * @param stagedOperations - Array of staged operations
 * @param id - The id of the element to find
 * @param tagName - Optional tagName for validation and better error messages
 * @returns The most recent record (from create or update), or undefined if not found in staged operations
 * @throws Error if element was deleted in staged operations
 */
export function getLatestStagedRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig> = ElementsOf<GenericConfig>,
>(params: {
	stagedOperations: Operation<GenericConfig>[]
	id: string
	tagName: GenericElement
	throwOnDeleted?: boolean
}):
	| {
			record: RawRecord<GenericConfig, GenericElement>
			status: Operation<GenericConfig>['status']
	  }
	| undefined {
	const { stagedOperations, id, tagName, throwOnDeleted = true } = params

	const operation = [...stagedOperations].reverse().find((operation) => {
		if (operation.status === 'created') return operation.newRecord.id === id
		if (operation.status === 'updated') return operation.newRecord.id === id
		if (operation.status === 'deleted') return operation.oldRecord.id === id
		return false
	})

	if (!operation) return undefined

	if (operation.status === 'deleted') {
		const tagInfo = tagName ? ` ${tagName}` : ''
		if (throwOnDeleted) throw new Error(`Element${tagInfo} with id ${id} has been deleted`)
	}

	const record = (
		operation.status === 'deleted' ? operation.oldRecord : operation.newRecord
	) as RawRecord<GenericConfig, GenericElement>

	// Validate tagName if provided
	if (record.tagName !== tagName) {
		throw new Error(
			`Element tagName mismatch: expected ${tagName}, got ${record.tagName} for id ${id}`,
		)
	}

	return { record, status: operation.status }
}
