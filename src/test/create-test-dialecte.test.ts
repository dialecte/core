import { TEST_DIALECTE_CONFIG } from './config'
import { createTestContext, createTestDialecte } from './create-test-dialecte'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

type TestCase = {
	description: string
	xmlString: string
	validate: (result: Awaited<ReturnType<typeof createTestDialecte>>) => Promise<void>
}

const SIMPLE_XML = /* xml */ `
<Root>
	<A aA="a1" bA="hello" />
	<A aA="a2" bA="world" />
	<B aB="b1" />
</Root>
`

describe('createTestDialecte', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const cleanup of cleanups) {
			await cleanup()
		}
		cleanups.length = 0
	})

	const testCases: TestCase[] = [
		{
			description: 'returns document and databaseName',
			xmlString: SIMPLE_XML,
			validate: async ({ document, databaseName }) => {
				expect(document).toBeDefined()
				expect(databaseName).toMatch(/^test-/)
			},
		},
		{
			description: 'document query can retrieve records by tagName',
			xmlString: SIMPLE_XML,
			validate: async ({ document }) => {
				const records = await document.query.getRecordsByTagName('A')
				expect(records).toHaveLength(2)
				expect(records.every((r) => r.tagName === 'A')).toBe(true)
			},
		},
		{
			description: 'cleanup deletes the database',
			xmlString: '<Root />',
			validate: async ({ databaseName, cleanup }) => {
				await cleanup()
				const exists = await Dexie.exists(databaseName)
				expect(exists).toBe(false)
				// Prevent afterEach from double-cleaning (cleanup already ran)
				cleanups.pop()
			},
		},
		{
			description: 'each call creates a unique database',
			xmlString: SIMPLE_XML,
			validate: async ({ databaseName }) => {
				const other = await createTestDialecte({ xmlString: SIMPLE_XML })
				cleanups.push(other.cleanup)
				expect(databaseName).not.toBe(other.databaseName)
			},
		},
	]

	for (const { description, xmlString, validate } of testCases) {
		it(description, async () => {
			const result = await createTestDialecte({ xmlString })
			cleanups.push(result.cleanup)
			await validate(result as any)
		})
	}
})

describe('createTestContext', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const cleanup of cleanups) {
			await cleanup()
		}
		cleanups.length = 0
	})

	it('returns a context whose store can retrieve records', async () => {
		const { databaseName, cleanup } = await createTestDialecte({ xmlString: SIMPLE_XML })
		cleanups.push(cleanup)

		const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })
		const records = await context.store.getByTagName('A')
		expect(records).toHaveLength(2)
	})

	it('returns a fresh recordCache and empty stagedOperations', async () => {
		const { databaseName, cleanup } = await createTestDialecte({ xmlString: SIMPLE_XML })
		cleanups.push(cleanup)

		const context = createTestContext({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })
		expect(context.recordCache?.size).toBe(0)
		expect(context.stagedOperations).toHaveLength(0)
	})
})
