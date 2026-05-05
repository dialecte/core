import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestDialecte } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/**
 * Methods on Query/Transaction that intentionally have NO any counterpart.
 * - getRoot: always typed (root element is config-defined)
 * - getFilename: returns string, no element typing involved
 * - getStagedOperations / clearStagedOperations / clearRecordCache: internal lifecycle
 * - getOperations / context: protected, not public API
 */
const QUERY_EXCLUDED = new Set(['getRoot', 'getFilename', 'getOperations', 'constructor'])

const TRANSACTION_EXCLUDED = new Set([
	'getStagedOperations',
	'clearStagedOperations',
	'clearRecordCache',
	'clearCumulativeCloneMappings',
	'commit',
	'constructor',
])

/**
 * Mapping from Query/Transaction method names to their AnyQuery/AnyTransaction counterparts.
 * Most are identity (same name); override here if naming diverges.
 */
const METHOD_RENAME: Record<string, string> = {
	// Query method → AnyQuery method (identity unless specified)
}

function getPublicMethods(proto: object): string[] {
	return Object.getOwnPropertyNames(proto).filter((name) => {
		if (name.startsWith('_')) return false
		const descriptor = Object.getOwnPropertyDescriptor(proto, name)
		return typeof descriptor?.value === 'function'
	})
}

describe('any namespace - API parity', () => {
	it('AnyQuery mirrors all expected Query public methods', async () => {
		const { document, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${ns}><A ${customId}="a1" /></Root>`,
		})

		try {
			const queryProto = Object.getPrototypeOf(document.query)
			const anyQueryProto = Object.getPrototypeOf(document.query.any)

			const queryMethods = getPublicMethods(queryProto).filter((m) => !QUERY_EXCLUDED.has(m))
			const anyQueryMethods = new Set(getPublicMethods(anyQueryProto))

			const missing: string[] = []
			for (const method of queryMethods) {
				const expected = METHOD_RENAME[method] ?? method
				if (!anyQueryMethods.has(expected)) {
					missing.push(`${method} -> expected ${expected}`)
				}
			}

			expect(missing, `AnyQuery is missing methods: ${missing.join(', ')}`).toHaveLength(0)
		} finally {
			await cleanup()
		}
	})

	it('AnyTransaction mirrors all expected Transaction mutation methods', async () => {
		const { document, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `<Root ${ns}><A ${customId}="a1" /></Root>`,
		})

		try {
			await document.transaction(async (tx) => {
				const txProto = Object.getPrototypeOf(tx)
				const anyTxProto = Object.getPrototypeOf(tx.any)
				const anyQueryProto = Object.getPrototypeOf(document.query.any)

				const txMethods = getPublicMethods(txProto)
					.filter((m) => !TRANSACTION_EXCLUDED.has(m))
					.filter((m) => !QUERY_EXCLUDED.has(m))

				const anyTxMethods = new Set([
					...getPublicMethods(anyTxProto),
					...getPublicMethods(anyQueryProto),
				])

				const missing: string[] = []
				for (const method of txMethods) {
					const expected = METHOD_RENAME[method] ?? method
					if (!anyTxMethods.has(expected)) {
						missing.push(`${method} -> expected ${expected}`)
					}
				}

				expect(missing, `AnyTransaction is missing methods: ${missing.join(', ')}`).toHaveLength(0)
			})
		} finally {
			await cleanup()
		}
	})
})

describe('any namespace - runtime smoke test', () => {
	it('CRUD cycle through any.*', async () => {
		const { document, cleanup } = await createTestDialecte({
			xmlString: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="parent" />
				</Root>
			`,
		})

		try {
			// Read via query.any
			const record = await document.query.any.getRecord({ tagName: 'A', id: 'a1' })
			expect(record).toBeDefined()
			expect(record!.tagName).toBe('A')

			const attr = await document.query.any.getAttribute(record!, { name: 'aA' })
			expect(attr).toBe('parent')

			// Mutation via transaction.any
			await document.transaction(async (tx) => {
				// addChild
				const child = await tx.any.addChild(record!, {
					tagName: 'AA_1',
					attributes: { aAA_1: 'created-via-any' },
				})
				expect(child.tagName).toBe('AA_1')

				// getChildren
				const children = await tx.any.getChildren(record!, 'AA_1')
				expect(children).toHaveLength(1)

				// update
				const updated = await tx.any.update(children[0], {
					attributes: { aAA_1: 'updated-via-any' },
				})
				expect(updated).toBeDefined()

				// getAttribute after update
				const updatedAttr = await tx.any.getAttribute(
					{ tagName: 'AA_1', id: child.id },
					{ name: 'aAA_1' },
				)
				expect(updatedAttr).toBe('updated-via-any')

				// delete
				await tx.any.delete({ tagName: 'AA_1', id: child.id })

				const afterDelete = await tx.any.getChildren(record!, 'AA_1')
				expect(afterDelete).toHaveLength(0)
			})
		} finally {
			await cleanup()
		}
	})
})
