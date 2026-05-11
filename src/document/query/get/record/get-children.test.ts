import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestProject,
	runTestCases,
	TEST_DIALECTE_CONFIG,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getChildren', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			parentRef: { tagName: 'A'; id: string }
			childTagName: 'AA_1' | 'AA_2' | 'AA_3'
			expectedCount: number
			expectedIds?: string[]
		}

		const testCases: TestCases<TestCase> = {
			'returns empty array when parent has no matching children': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedCount: 0,
			},
			'returns all matching children': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="first" />
							<AA_1 ${customId}="aa2" aAA_1="second" />
							<AA_1 ${customId}="aa3" aAA_1="third" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedCount: 3,
				expectedIds: ['aa1', 'aa2', 'aa3'],
			},
			'returns only children matching requested tag, ignores siblings of other tags': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="v" />
							<AA_2 ${customId}="aa2" aAA_2="v" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedCount: 1,
				expectedIds: ['aa1'],
			},
			'returns empty array when parent does not exist': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				parentRef: { tagName: 'A', id: 'non-existent' },
				childTagName: 'AA_1',
				expectedCount: 0,
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const children = await source.query.getChildren(testCase.parentRef, testCase.childTagName)

			expect(children).toHaveLength(testCase.expectedCount)

			if (testCase.expectedIds) {
				const ids = children.map((c) => c.id)
				for (const id of testCase.expectedIds) expect(ids).toContain(id)
			}

			for (const child of children) {
				expect(child.tagName).toBe(testCase.childTagName)
				expect(child.status).toBe('unchanged')
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('includes staged created children', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'x' } },
					)
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-2', attributes: { aAA_1: 'y' } },
					)

					const children = await tx.getChildren({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(children).toHaveLength(2)
					expect(children.map((c) => c.id)).toContain('0-0-0-0-1')
					expect(children.map((c) => c.id)).toContain('0-0-0-0-2')
				})
			} finally {
				await project.destroy()
			}
		})

		it('excludes staged deleted children', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="c" />
						<AA_1 ${customId}="aa2" aAA_1="d" />
					</A>
				</Root>
			`
			const { source, project } = await createTestProject({ sourceXml: xmlString })
			const document = source.document

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const children = await tx.getChildren({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(children).toHaveLength(1)
					expect(children[0].id).toBe('aa2')
				})
			} finally {
				await project.destroy()
			}
		})
	})

	describe('transparent elements', () => {
		const configWithTransparent = {
			...TEST_DIALECTE_CONFIG,
			transparentElements: ['AA_1'] as const,
		}

		type TestCase = {
			description: string
			sourceXml: string
			parentRef: { tagName: string; id: string }
			childTagName: string
			expectedCount: number
			expectedIds?: string[]
			useTransparentConfig?: boolean
		}

		const testCases: TestCase[] = [
			{
				description: 'finds children through a transparent wrapper element',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="wrapper">
								<AAA_1 ${customId}="aaa1" aAAA_1="deep1" />
								<AAA_1 ${customId}="aaa2" aAAA_1="deep2" />
							</AA_1>
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedCount: 2,
				expectedIds: ['aaa1', 'aaa2'],
				useTransparentConfig: true,
			},
			{
				description: 'returns direct children preferentially over transparent lookup',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="direct" />
							<AA_2 ${customId}="aa2" aAA_2="other" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedCount: 1,
				expectedIds: ['aa1'],
				useTransparentConfig: true,
			},
			{
				description: 'returns empty when transparent wrapper has no matching children',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="empty-wrapper" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedCount: 0,
				useTransparentConfig: true,
			},
			{
				description: 'collects children from multiple transparent wrappers',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="wrapper1">
								<AAA_1 ${customId}="aaa1" aAAA_1="from-first" />
							</AA_1>
							<AA_1 ${customId}="aa2" aAA_1="wrapper2">
								<AAA_1 ${customId}="aaa2" aAAA_1="from-second" />
							</AA_1>
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedCount: 2,
				expectedIds: ['aaa1', 'aaa2'],
				useTransparentConfig: true,
			},
			{
				description: 'does not look through elements when config has no transparentElements',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="wrapper">
								<AAA_1 ${customId}="aaa1" aAAA_1="hidden" />
							</AA_1>
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedCount: 0,
				useTransparentConfig: false,
			},
		]

		for (const testCase of testCases) {
			it(testCase.description, async () => {
				const { source, project } = await createTestProject({
					sourceXml: testCase.sourceXml,
					dialecteConfig: testCase.useTransparentConfig
						? configWithTransparent
						: TEST_DIALECTE_CONFIG,
				})

				try {
					const children = await source.document.query.any.getChildren(
						testCase.parentRef,
						testCase.childTagName,
					)

					expect(children).toHaveLength(testCase.expectedCount)

					if (testCase.expectedIds) {
						const ids = children.map((c) => c.id)
						for (const id of testCase.expectedIds) expect(ids).toContain(id)
					}
				} finally {
					await project.destroy()
				}
			})
		}
	})
})
