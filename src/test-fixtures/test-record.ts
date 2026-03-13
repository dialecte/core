import { TEST_DIALECTE_CONFIG } from './config'

import { standardizeRecord, toTrackedRecord, toTreeRecord } from '@/helpers'

import type { TestRecord } from './test-record.types'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord, TreeRecord } from '@/types'

/**
 * Creates a `createTestRecord` function bound to a specific dialecte config.
 *
 * Use this in a dialecte package to expose a properly-typed record factory
 * without re-implementing the logic.
 *
 */
export function createTestRecordFactory<GenericConfig extends AnyDialecteConfig>(
	dialecteConfig: GenericConfig,
) {
	function createTestRecord(params: {
		record: TestRecord<GenericConfig>
	}): RawRecord<GenericConfig, ElementsOf<GenericConfig>>

	function createTestRecord(params: {
		type: 'raw'
		record: TestRecord<GenericConfig>
	}): RawRecord<GenericConfig, ElementsOf<GenericConfig>>

	function createTestRecord(params: {
		type: 'tracked'
		record: TestRecord<GenericConfig>
	}): TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>

	function createTestRecord(params: {
		type: 'tree'
		record: TestRecord<GenericConfig>
	}): TreeRecord<GenericConfig, ElementsOf<GenericConfig>>

	function createTestRecord(params: {
		type?: 'raw' | 'tracked' | 'tree'
		record: TestRecord<GenericConfig>
	}):
		| RawRecord<GenericConfig, ElementsOf<GenericConfig>>
		| TrackedRecord<GenericConfig, ElementsOf<GenericConfig>>
		| TreeRecord<GenericConfig, ElementsOf<GenericConfig>> {
		const { record, type = 'raw' } = params

		const standardizedRecord = standardizeRecord({ record, dialecteConfig })

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

	return createTestRecord
}

export const createTestRecord = createTestRecordFactory(TEST_DIALECTE_CONFIG)
