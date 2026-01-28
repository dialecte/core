import Dexie from 'dexie'
import { afterEach, describe, it, expect, Test } from 'vitest'

import { TEST_DIALECTE_CONFIG } from './config'
import { createTestDialecte } from './create-test-dialecte'

import type { DialecteCore } from '@/dialecte'

type TestConfig = typeof TEST_DIALECTE_CONFIG

const VALID_XML = `
<Root>
	<A id="a1">
		<B id="b1" />
		<B id="b2" />
	</A>
	<C id="c1" />
</Root>
`

describe('createTestDialecte', () => {
	const cleanupFunctions: Array<() => Promise<void>> = []

	afterEach(async () => {
		// Clean up all databases created during tests
		for (const cleanup of cleanupFunctions) {
			await cleanup()
		}
		cleanupFunctions.length = 0
	})

	const testCases = [
		{
			description: 'creates dialecte instance with valid XML',
			xmlString: VALID_XML,
			extensions: undefined,
			hooks: undefined,
			expectedRecordCount: 4, // Root, A, B, B, C
			validate: async (result: Awaited<ReturnType<typeof createTestDialecte<TestConfig>>>) => {
				expect(result.dialecte).toBeDefined()
				expect(result.databaseName).toMatch(/^test-/)
				expect(typeof result.cleanup).toBe('function')

				const rootContext = await result.dialecte.fromRoot().getContext()
				expect(rootContext.currentFocus.tagName).toBe('Root')
			},
		},
		{
			description: 'creates unique database names for multiple calls',
			xmlString: VALID_XML,
			extensions: undefined,
			hooks: undefined,
			expectedRecordCount: 4,
			validate: async (result: Awaited<ReturnType<typeof createTestDialecte<TestConfig>>>) => {
				const result2 = await createTestDialecte({
					xmlString: VALID_XML,
				})
				cleanupFunctions.push(result2.cleanup)

				expect(result.databaseName).not.toBe(result2.databaseName)
				expect(result.dialecte).not.toBe(result2.dialecte)
			},
		},
		{
			description: 'creates empty database with minimal XML',
			xmlString: '<Root />',
			extensions: undefined,
			hooks: undefined,
			expectedRecordCount: 1,
			validate: async (result: Awaited<ReturnType<typeof createTestDialecte<TestConfig>>>) => {
				const rootContext = await result.dialecte.fromRoot().getContext()
				expect(rootContext.currentFocus.tagName).toBe('Root')
				expect(rootContext.currentFocus.children).toHaveLength(0)
			},
		},
		{
			description: 'creates database with nested structure',
			xmlString: `
				<Root>
					<A aA="a1">
						<B aB="b1">
							<C aC="c1" />
						</B>
					</A>
				</Root>
			`,
			extensions: undefined,
			hooks: undefined,
			expectedRecordCount: 4,
			validate: async (result: Awaited<ReturnType<typeof createTestDialecte<TestConfig>>>) => {
				const aContext = await result.dialecte.fromElement({ tagName: 'A' }).getContext()
				expect(aContext.currentFocus.children).toHaveLength(1)

				const bContext = await result.dialecte.fromElement({ tagName: 'B' }).getContext()
				expect(bContext.currentFocus.children).toHaveLength(1)
			},
		},
	]

	for (const testCase of testCases) {
		const { description, xmlString, validate } = testCase

		it(description, async () => {
			const result = await createTestDialecte({
				xmlString,
			})

			cleanupFunctions.push(result.cleanup)

			await validate(result)
		})
	}

	describe('cleanup function', () => {
		it('closes database and deletes it from IndexedDB', async () => {
			const result = await createTestDialecte({
				xmlString: VALID_XML,
			})

			const dbName = result.databaseName

			// Verify database exists
			const dbsBefore = await Dexie.getDatabaseNames()
			expect(dbsBefore).toContain(dbName)

			// Run cleanup
			await result.cleanup()

			// Verify database is deleted
			const dbsAfter = await Dexie.getDatabaseNames()
			expect(dbsAfter).not.toContain(dbName)

			// Verify database is closed
			const databaseInstance = result.dialecte.getDatabaseInstance()
			expect(databaseInstance?.isOpen()).toBe(false)
		})

		it('handles cleanup when database already closed', async () => {
			const result = await createTestDialecte({
				xmlString: VALID_XML,
			})

			// Close database manually
			const databaseInstance = result.dialecte.getDatabaseInstance()
			databaseInstance?.close()

			// Cleanup should still work
			await expect(result.cleanup()).resolves.not.toThrow()

			// Verify database is deleted
			const dbsAfter = await Dexie.getDatabaseNames()
			expect(dbsAfter).not.toContain(result.databaseName)
		})

		it('can be called multiple times safely', async () => {
			const result = await createTestDialecte({
				xmlString: VALID_XML,
			})

			await result.cleanup()
			await expect(result.cleanup()).resolves.not.toThrow()
		})
	})

	describe('database state', () => {
		it('imports XML with correct record count', async () => {
			const result = await createTestDialecte({
				xmlString: VALID_XML,
			})
			cleanupFunctions.push(result.cleanup)

			const databaseInstance = result.dialecte.getDatabaseInstance()
			const count = await databaseInstance?.table('xmlElements').count()
			expect(count).toBe(5) // Root + A + B + B + C
		})

		it('uses custom record IDs', async () => {
			const result = await createTestDialecte({
				xmlString: VALID_XML,
			})
			cleanupFunctions.push(result.cleanup)

			const rootContext = await result.dialecte.fromRoot().getContext()
			// Custom IDs are deterministic based on content and position
			expect(rootContext.currentFocus.id).toMatch(/^[a-f0-9-]+$/)
		})
	})
})
