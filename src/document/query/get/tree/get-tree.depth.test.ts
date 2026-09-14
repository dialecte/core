import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, createTestProject } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

// A > AA_1 > AAA_1 (three levels) so depth boundaries are observable.
const sourceXml = /* xml */ `
	<Root ${ns}>
		<A ${customId}="a1" aA="v">
			<AA_1 ${customId}="aa1" aAA_1="v">
				<AAA_1 ${customId}="aaa1" aAAA_1="v" />
			</AA_1>
		</A>
	</Root>
`

describe('getTree — depth', () => {
	it('depth:0 returns the node alone (empty tree, children refs kept)', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 0 })
			expect(tree?.tree).toEqual([])
			expect(tree?.children.length).toBe(1) // hasChildren via refs, though unexpanded
		} finally {
			await project.destroy()
		}
	})

	it('depth:1 expands one level; deeper nodes keep children refs but an empty tree', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
			expect(tree?.tree.map((child) => child.tagName)).toEqual(['AA_1'])
			const aa1 = tree?.tree[0]
			expect(aa1?.tree).toEqual([]) // AAA_1 not expanded at depth 1
			expect(aa1?.children.length).toBe(1) // but hasChildren
		} finally {
			await project.destroy()
		}
	})

	it('depth undefined expands the full tree (unchanged behaviour)', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			const tree = await source.document.query.any.getTree({ tagName: 'A', id: 'a1' })
			expect(tree?.tree[0]?.tree.map((child) => child.tagName)).toEqual(['AAA_1'])
		} finally {
			await project.destroy()
		}
	})

	it('bounded depth reads only the needed levels (getMany, not the whole document)', async () => {
		const { project, source } = await createTestProject({ sourceXml, dev: { perf: true } })
		try {
			const doc = source.document
			doc.perf.reset()
			await doc.query.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
			const report = doc.perf.report()
			expect(report['core::store::getByDocumentId']?.count ?? 0).toBe(0)
			expect(report['core::store::getMany']?.count ?? 0).toBeGreaterThanOrEqual(1)
		} finally {
			await project.destroy()
		}
	})

	it('bounded depth reflects staged writes inside a transaction', async () => {
		const { project, source } = await createTestProject({ sourceXml })
		try {
			await source.document.transaction(async (tx) => {
				await tx.any.addChild({ tagName: 'A', id: 'a1' }, { tagName: 'AA_2', attributes: {} })
				const tree = await tx.any.getTree({ tagName: 'A', id: 'a1' }, { depth: 1 })
				expect(tree?.tree.map((child) => child.tagName).sort()).toEqual(['AA_1', 'AA_2'])
			})
		} finally {
			await project.destroy()
		}
	})
})
