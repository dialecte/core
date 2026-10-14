import { describe, expect, vi } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'
import type { Operation } from '@/types'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

const sourceXml = /* xml */ `
	<Root ${ns} ${customId}="root">
		<A ${customId}="a1" aA="kept" />
	</Root>
`

const parent = { tagName: 'A', id: 'a1' } as const

describe('beforeCommit hook — when it is called', () => {
	const beforeCommit = vi.fn()
	const hooks = { beforeCommit }

	type TestCase = BaseXmlTestCase & {
		expectedStatuses: Operation<TestDialecteConfig>['status'][]
	}

	const testCases: TestCases<TestCase> = {
		'a transaction adding and updating -> called once, after the callback, with every staged operation':
			{
				sourceXml,
				// the created AA_2, its parent A updated, then AA_2 updated
				expectedStatuses: ['created', 'updated', 'updated'],
			},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const order: string[] = []
		beforeCommit.mockReset()
		beforeCommit.mockImplementation(async () => {
			order.push('beforeCommit')
			return []
		})
		await source.transaction(async (tx) => {
			const added = await tx.addChild(parent, { tagName: 'AA_2', attributes: { aAA_2: 'new' } })
			await tx.update(added, { attributes: { bAA_2: 'updated' } })
			order.push('callback done')
		})
		expect(order).toEqual(['callback done', 'beforeCommit'])
		expect(beforeCommit).toHaveBeenCalledOnce()
		const [[callArgs]] = beforeCommit.mock.calls
		expect(
			callArgs.operations.map((operation: Operation<TestDialecteConfig>) => operation.status),
		).toEqual(testCase.expectedStatuses)
	}

	runTestCases.withoutExport({ testCases, act, hooks })
})

describe('beforeCommit hook — returned operations applied', () => {
	const afterUpdated = vi.fn(async () => [])
	const hooks = { beforeCommit: completeCreatedAA2, afterUpdated }

	const testCases: TestCases<BaseXmlTestCase> = {
		'an AA_2 created without bAA_2 -> completed by the hook, in the export; the hooks are not called again':
			{
				sourceXml,
				expectedQueries: ['//default:A[@aA="kept"]/default:AA_2[@aAA_2="new"][@bAA_2="completed"]'],
			},
	}

	async function act({
		source,
	}: ActParams<TestDialecteConfig, BaseXmlTestCase>): Promise<ActResult> {
		afterUpdated.mockClear()
		await source.transaction(async (tx) => {
			await tx.addChild(parent, { tagName: 'AA_2', attributes: { aAA_2: 'new' } })
		})
		expect(afterUpdated).not.toHaveBeenCalled()
		return {}
	}

	runTestCases.withExport({ testCases, act, hooks })
})

describe('beforeCommit hook — prepare', () => {
	const beforeCommit = vi.fn(completeCreatedAA2)
	const hooks = { beforeCommit }

	const testCases: TestCases<BaseXmlTestCase> = {
		'a prepared transaction -> its preview holds what the hook adds, committing does not call it again':
			{ sourceXml },
	}

	async function act({ source }: ActParams<TestDialecteConfig, BaseXmlTestCase>): Promise<void> {
		beforeCommit.mockClear()
		const prepared = await source.prepare(async (tx) => {
			await tx.addChild(parent, { tagName: 'AA_2', attributes: { aAA_2: 'new' } })
		})
		const previewedValues = prepared.operations
			.flatMap((operation) => operation.newRecord?.attributes ?? [])
			.map((attribute) => attribute.value)
		expect(previewedValues).toContain('completed')

		await prepared.commit()
		expect(beforeCommit).toHaveBeenCalledOnce()
	}

	runTestCases.withoutExport({ testCases, act, hooks })
})

/** Completes every AA_2 the transaction created without its bAA_2 attribute. */
async function completeCreatedAA2(params: {
	operations: ReadonlyArray<Operation<TestDialecteConfig>>
}): Promise<Operation<TestDialecteConfig>[]> {
	const completions: Operation<TestDialecteConfig>[] = []
	for (const operation of params.operations) {
		const record = operation.newRecord
		if (operation.status !== 'created' || !record || record.tagName !== 'AA_2') continue
		if (record.attributes.some((attribute) => attribute.name === 'bAA_2')) continue
		const completed = { ...record, attributes: [...record.attributes] }
		completed.attributes.push({
			name: 'bAA_2',
			value: 'completed',
		} as (typeof completed.attributes)[number])
		completions.push({ status: 'updated', oldRecord: record, newRecord: completed })
	}
	return completions
}
