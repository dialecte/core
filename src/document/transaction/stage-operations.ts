import { toRawRecord } from '@/helpers'
import { assert } from '@/utils'

import type { Context } from '@/document'
import type { AnyDialecteConfig, Operation, RawRecord, ElementsOf } from '@/types'

export function stageOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	status: 'created'
	record: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function stageOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	status: 'updated'
	oldRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
	newRecord: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function stageOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	status: 'deleted'
	record: RawRecord<GenericConfig, ElementsOf<GenericConfig>>
}): void
export function stageOperation<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
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
		assert(rawRecord, {
			detail: 'Record is required for created',
			method: 'stageOperation',
			key: 'ELEMENT_NOT_FOUND',
		})
		context.stagedOperations.push({ status, oldRecord: undefined, newRecord: rawRecord })
	} else if (status === 'updated') {
		assert(rawOldRecord && rawNewRecord, {
			detail: 'Old record and new record are required for updated',
			method: 'stageOperation',
			key: 'ELEMENT_NOT_FOUND',
		})
		context.stagedOperations.push({ status, oldRecord: rawOldRecord, newRecord: rawNewRecord })
	} else if (status === 'deleted' && rawRecord) {
		assert(rawRecord, {
			detail: 'Record is required for deleted',
			method: 'stageOperation',
			key: 'ELEMENT_NOT_FOUND',
		})
		context.stagedOperations.push({ status, oldRecord: rawRecord, newRecord: undefined })
	}
}

export function stageOperations<GenericConfig extends AnyDialecteConfig>(params: {
	context: Context<GenericConfig>
	operations: Operation<GenericConfig>[]
}) {
	const { context, operations } = params
	for (const operation of operations) {
		switch (operation.status) {
			case 'created':
				stageOperation({ context, status: 'created', record: operation.newRecord })
				break
			case 'updated':
				stageOperation({
					context,
					status: 'updated',
					oldRecord: operation.oldRecord,
					newRecord: operation.newRecord,
				})
				break
			case 'deleted':
				stageOperation({ context, status: 'deleted', record: operation.oldRecord })
				break
		}
	}
}
