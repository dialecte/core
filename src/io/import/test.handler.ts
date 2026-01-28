import { expect } from 'vitest'

import type { ExpectedRecord, ExpectedRecords } from './test.types'
import type { AnyDatabaseInstance } from '@/database'
import type { AnyRawRecord, AnyDialecteConfig } from '@/types'

//====== MAIN FUNCTION ======//

export async function handleExpectedRecords(params: {
	dialecteConfig: AnyDialecteConfig
	databaseInstance: AnyDatabaseInstance
	expectedRecords: ExpectedRecords
}) {
	const { dialecteConfig, databaseInstance, expectedRecords } = params

	const elementsTableName = dialecteConfig.database.tables.xmlElements.name
	await handleExpectedCount({ elementsTableName, databaseInstance, expectedRecords })

	for (const expectedRecord of expectedRecords) {
		const actualRecord = await databaseInstance.table(elementsTableName).get(expectedRecord.id)
		expect(actualRecord).toBeDefined()

		handleExpectedParent(expectedRecord, actualRecord)
		handleExpectedChildren(expectedRecord, actualRecord)
		handleExpectedAttributes(expectedRecord, actualRecord)
		handleExpectedNamespace(expectedRecord, actualRecord)
		handleExpectedValue(expectedRecord, actualRecord)
	}
}

//====== HANDLERS ======//

async function handleExpectedCount(params: {
	elementsTableName: string
	databaseInstance: AnyDatabaseInstance
	expectedRecords: ExpectedRecords
}) {
	const { elementsTableName, databaseInstance, expectedRecords } = params

	const recordsPerTagNames = expectedRecords.reduce(
		(acc, record) => {
			acc[record.tagName] = (acc[record.tagName] || 0) + 1
			return acc
		},
		{} as { [tagName: string]: number },
	)

	for (const [tagName, expectedCount] of Object.entries(recordsPerTagNames)) {
		const numberOfElements = await databaseInstance
			.table(elementsTableName)
			.where({ tagName })
			.count()
		expect(numberOfElements).toEqual(expectedCount)
	}
}

function handleExpectedParent(expectedRecord: ExpectedRecord, actualRecord: AnyRawRecord) {
	if (expectedRecord.parent !== undefined) {
		const actualParent = actualRecord?.parent

		if (expectedRecord.parent === null) expect(actualParent).toBeNull()
		else {
			expect(actualParent).toBeDefined()
			expect(actualParent).toEqual(expectedRecord.parent)
		}
	}
}

function handleExpectedChildren(expectedRecord: ExpectedRecord, actualRecord: AnyRawRecord) {
	if (expectedRecord.children?.length) {
		const actualChildren = actualRecord?.children

		expect(actualChildren).toBeDefined()
		expect(actualChildren).toHaveLength(expectedRecord.children.length)
		expect(actualChildren).toEqual(expectedRecord.children)
	}
}

function handleExpectedAttributes(expectedRecord: ExpectedRecord, actualRecord: AnyRawRecord) {
	if (expectedRecord.attributes?.length) {
		const actualAttributes = actualRecord?.attributes
		expect(actualAttributes).toBeDefined()
		expect(actualAttributes).toHaveLength(expectedRecord.attributes.length)
		expect(actualAttributes).toEqual(expectedRecord.attributes)
	}
}

function handleExpectedNamespace(expectedRecord: ExpectedRecord, actualRecord: AnyRawRecord) {
	if (expectedRecord.namespace !== undefined) {
		const actualNamespace = actualRecord?.namespace

		if (expectedRecord.namespace === null) expect(actualNamespace).toBeNull()
		else {
			expect(actualNamespace).toBeDefined()
			expect(actualNamespace).toEqual(expectedRecord.namespace)
		}
	}
}

function handleExpectedValue(expectedRecord: ExpectedRecord, actualRecord: AnyRawRecord) {
	if (expectedRecord.value) {
		const actualValue = actualRecord?.value
		expect(actualValue).toBeDefined()
		expect(actualValue).toEqual(expectedRecord.value)
	}
}
