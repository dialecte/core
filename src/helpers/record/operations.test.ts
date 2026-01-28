import { describe, it, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, createTestRecord } from '../test-fixtures'

import { addStagedOperation } from './operations'

import type { Operation } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

describe('addStagedOperation', () => {
	it('adds created operation', () => {
		const context: { stagedOperations: Operation<TestDialecteConfig>[] } = { stagedOperations: [] }
		const record = createTestRecord({ record: { id: '1', tagName: 'A' } })

		addStagedOperation({ context, status: 'created', record })

		expect(context.stagedOperations).toHaveLength(1)
		expect(context.stagedOperations[0].status).toBe('created')
		expect(context.stagedOperations[0].newRecord?.id).toBe('1')
		expect(context.stagedOperations[0].oldRecord).toBeUndefined()
	})

	it('adds updated operation', () => {
		const context: { stagedOperations: Operation<TestDialecteConfig>[] } = { stagedOperations: [] }
		const oldRecord = createTestRecord({ record: { id: '1', tagName: 'A' } })
		const newRecord = createTestRecord({ record: { id: '1', tagName: 'A' } })

		addStagedOperation({ context, status: 'updated', oldRecord, newRecord })

		expect(context.stagedOperations).toHaveLength(1)
		expect(context.stagedOperations[0].status).toBe('updated')
		expect(context.stagedOperations[0].oldRecord?.id).toBe('1')
		expect(context.stagedOperations[0].newRecord?.id).toBe('1')
	})

	it('adds deleted operation', () => {
		const context: { stagedOperations: Operation<TestDialecteConfig>[] } = { stagedOperations: [] }
		const record = createTestRecord({ record: { id: '1', tagName: 'A' } })

		addStagedOperation({ context, status: 'deleted', record })

		expect(context.stagedOperations).toHaveLength(1)
		expect(context.stagedOperations[0].status).toBe('deleted')
		expect(context.stagedOperations[0].oldRecord?.id).toBe('1')
		expect(context.stagedOperations[0].newRecord).toBeUndefined()
	})
})
