import { assert } from '../assert'

import { toRawRecord } from '.'

import type { Operation, RawRecord, ElementsOf, AnyDialecteConfig } from '@/types'

export function addStagedOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: { stagedOperations: Operation<GenericConfig>[] }
	status: 'created'
	record: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function addStagedOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: { stagedOperations: Operation<GenericConfig>[] }
	status: 'updated'
	oldRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	newRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function addStagedOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: { stagedOperations: Operation<GenericConfig>[] }
	status: 'deleted'
	record: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function addStagedOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: { stagedOperations: Operation<GenericConfig>[] }
	status: Operation<GenericConfig>['status']
	record?: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	oldRecord?: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	newRecord?: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}) {
	const { context, status, record, oldRecord, newRecord } = params

	let rawRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
	let rawOldRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
	let rawNewRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined

	if (record) rawRecord = toRawRecord(record)
	if (oldRecord) rawOldRecord = toRawRecord(oldRecord)
	if (newRecord) rawNewRecord = toRawRecord(newRecord)

	if (status === 'created') {
		assert(rawRecord, 'record is required for created')
		context.stagedOperations.push({ status, oldRecord: undefined, newRecord: rawRecord })
	} else if (status === 'updated') {
		assert(rawOldRecord && rawNewRecord, 'oldRecord and newRecord are required for updated')
		context.stagedOperations.push({ status, oldRecord: rawOldRecord, newRecord: rawNewRecord })
	} else if (status === 'deleted' && rawRecord) {
		assert(rawRecord, 'record is required for deleted')
		context.stagedOperations.push({ status, oldRecord: rawRecord, newRecord: undefined })
	}
}
