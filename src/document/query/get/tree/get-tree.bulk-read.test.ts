import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestProject } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

/**
 * getTree must materialize a subtree from ONE whole-document read, not one store round-trip
 * per node. On IndexedDB the per-node path is catastrophic (17s/5MB, 143s/10MB); a single
 * bulk read + in-memory assembly is ~1s. This locks the contract.
 */
describe('getTree — single bulk read', () => {
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="v">
				<AA_1 ${customId}="aa1" aAA_1="v">
					<AAA_1 ${customId}="aaa1" aAAA_1="v" />
				</AA_1>
				<AA_2 ${customId}="aa2" aAA_2="v" />
			</A>
		</Root>
	`

	it('issues zero per-node store.get and one getByDocumentId', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			doc.perf.reset()

			const tree = await doc.query.any.getTree({ tagName: 'A', id: 'a1' })

			const report = doc.perf.report()
			expect(report['core::store::get']?.count ?? 0).toBe(0)
			expect(report['core::store::getByDocumentId']?.count ?? 0).toBe(1)

			// Sanity: the assembled tree is still correct.
			expect(tree?.tagName).toBe('A')
			expect(tree?.tree.map((child) => child.tagName).sort()).toEqual(['AA_1', 'AA_2'])
			const aa1 = tree?.tree.find((child) => child.tagName === 'AA_1')
			expect(aa1?.tree.map((child) => child.tagName)).toEqual(['AAA_1'])
		} finally {
			await project.destroy()
		}
	})
})
