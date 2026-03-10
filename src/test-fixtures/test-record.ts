import { TEST_DIALECTE_CONFIG } from './config'

import { standardizeRecord, toTrackedRecord, toTreeRecord } from '@/helpers'

import type {
	ElementsOf,
	FullAttributeObjectOf,
	RawRecord,
	TrackedRecord,
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
	type: 'tracked'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}): TrackedRecord<TestDialecteConfig, GenericElement>

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
	type?: 'raw' | 'tracked' | 'tree'
	record: {
		tagName: GenericElement
		attributes?:
			| AttributesValueObjectOf<TestDialecteConfig, GenericElement>
			| FullAttributeObjectOf<TestDialecteConfig, GenericElement>[]
	} & Partial<RawRecord<TestDialecteConfig, GenericElement>>
}):
	| RawRecord<TestDialecteConfig, GenericElement>
	| TrackedRecord<TestDialecteConfig, GenericElement>
	| TreeRecord<TestDialecteConfig, GenericElement> {
	const { record, type = 'raw' } = params

	const standardizedRecord = standardizeRecord({
		record,
		dialecteConfig: TEST_DIALECTE_CONFIG,
	})

	switch (type) {
		case 'raw':
			return standardizedRecord
		case 'tracked':
			return toTrackedRecord({ record: standardizedRecord })
		case 'tree':
			return toTreeRecord({ record: standardizedRecord })
		default:
			throw new Error(`Unsupported record type: ${type}`)
	}
}
