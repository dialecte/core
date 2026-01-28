import { standardizeRecord, toChainRecord, toTreeRecord } from '../record'

import { TEST_DIALECTE_CONFIG } from './config'

import type {
	ElementsOf,
	FullAttributeObjectOf,
	RawRecord,
	ChainRecord,
	AttributesValueObjectOf,
	TreeRecord,
} from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

/**
 * Create a test record for TEST_DIALECTE_CONFIG
 * Helper function for test data generation
 */

// Omitting type defaults to 'raw'
export function createTestRecord<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}): RawRecord<TestDialecteConfig, GenericElement>

export function createTestRecord<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
	type: 'raw'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}): RawRecord<TestDialecteConfig, GenericElement>

export function createTestRecord<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
	type: 'chain'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}): ChainRecord<TestDialecteConfig, GenericElement>

export function createTestRecord<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
	type: 'tree'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}): TreeRecord<TestDialecteConfig, GenericElement>

export function createTestRecord<GenericElement extends ElementsOf<TestDialecteConfig>>(params: {
	type?: 'raw' | 'chain' | 'tree'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}):
	| RawRecord<TestDialecteConfig, GenericElement>
	| ChainRecord<TestDialecteConfig, GenericElement>
	| TreeRecord<TestDialecteConfig, GenericElement> {
	const { record, type = 'raw' } = params

	const standardizedRecord = standardizeRecord({
		record,
		dialecteConfig: TEST_DIALECTE_CONFIG,
	})

	switch (type) {
		case 'raw':
			return standardizedRecord
		case 'chain':
			return toChainRecord({ record: standardizedRecord })
		case 'tree':
			return toTreeRecord({ record: standardizedRecord })
		default:
			throw new Error(`Unsupported record type: ${type}`)
	}
}
