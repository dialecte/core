import { TEST_DIALECTE_CONFIG } from './config'

import { standardizeRecord, toTrackedRecord, toTreeRecord } from '@/helpers'

import type { TestRecord } from './test-record.types'
import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord, TreeRecord } from '@/types'

/**
 * A record factory bound to a dialecte config: given a record (its tag and fields) and a `type`, it builds a raw
 * (default), tracked or tree record of that dialecte, standardized as core stores it.
 *
 * Use this in a dialecte package to expose a properly-typed record factory
 * without re-implementing the logic.
 *
 * @intent build typed test records for a dialecte, expose a record factory in a dialecte's test entry
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

/**
 * A raw, tracked or tree record of core's test dialecte for a unit test: `createTestRecordFactory` bound to the
 * test config.
 *
 * @internal record factory of core's own unit tests
 */
export const createTestRecord = createTestRecordFactory(TEST_DIALECTE_CONFIG)
