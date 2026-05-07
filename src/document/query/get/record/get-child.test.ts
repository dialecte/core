import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestDialecte,
	runTestCases,
	TEST_DIALECTE_CONFIG,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const customId = CUSTOM_RECORD_ID_ATTRIBUTE

describe('getChild', () => {
	describe('store reads', () => {
		type TestCase = BaseXmlTestCase & {
			parentRef: { tagName: 'A'; id: string }
			childTagName: 'AA_1' | 'AA_2' | 'AA_3'
			expectedId?: string
			expectUndefined?: true
		}

		const testCases: TestCases<TestCase> = {
			'returns matching child record': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="c" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedId: 'aa1',
			},
			'returns first child when multiple exist': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="first" />
							<AA_1 ${customId}="aa2" aAA_1="second" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedId: 'aa1',
			},
			'returns undefined when parent has no matching child tag': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="c" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_2',
				expectUndefined: true,
			},
			'returns undefined when parent does not exist': {
				sourceXml: /* xml */ `<Root ${ns} />`,
				parentRef: { tagName: 'A', id: 'non-existent' },
				childTagName: 'AA_1',
				expectUndefined: true,
			},
			'returns undefined when parent has no children': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v" />
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectUndefined: true,
			},
		}

		async function act({
			source,
			testCase,
		}: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
			const child = await source.document.query.getChild(testCase.parentRef, testCase.childTagName)

			if (testCase.expectUndefined) {
				expect(child).toBeUndefined()
			} else {
				expect(child).toBeDefined()
				if (testCase.expectedId !== undefined) expect(child?.id).toBe(testCase.expectedId)
				expect(child?.tagName).toBe(testCase.childTagName)
				expect(child?.status).toBe('unchanged')
			}
		}

		runTestCases.withoutExport({ testCases, act })
	})

	describe('staged operation visibility', () => {
		it('returns staged created child within transaction', async () => {
			const xmlString = /* xml */ `<Root ${ns}><A ${customId}="a1" aA="v" /></Root>`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{ tagName: 'AA_1', id: '0-0-0-0-1', attributes: { aAA_1: 'new' } },
					)

					const child = await tx.getChild({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(child).toBeDefined()
					expect(child?.id).toBe('0-0-0-0-1')
					expect(child?.status).toBe('created')
				})
			} finally {
				await cleanup()
			}
		})

		it('returns undefined for staged deleted child', async () => {
			const xmlString = /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="v">
						<AA_1 ${customId}="aa1" aAA_1="c" />
					</A>
				</Root>
			`
			const { document, cleanup } = await createTestDialecte({ xmlString })

			try {
				await document.transaction(async (tx) => {
					await tx.delete({ tagName: 'AA_1', id: 'aa1' })

					const child = await tx.getChild({ tagName: 'A', id: 'a1' }, 'AA_1')

					expect(child).toBeUndefined()
				})
			} finally {
				await cleanup()
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
			expectedId?: string
			expectUndefined?: true
			useTransparentConfig?: boolean
		}

		const testCases: TestCase[] = [
			{
				description: 'finds child through a transparent wrapper element',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="wrapper">
								<AAA_1 ${customId}="aaa1" aAAA_1="deep" />
							</AA_1>
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedId: 'aaa1',
				useTransparentConfig: true,
			},
			{
				description: 'returns direct child preferentially over transparent lookup',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="direct" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AA_1',
				expectedId: 'aa1',
				useTransparentConfig: true,
			},
			{
				description: 'returns first match from first transparent wrapper',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="wrapper1">
								<AAA_1 ${customId}="aaa1" aAAA_1="first" />
							</AA_1>
							<AA_1 ${customId}="aa2" aAA_1="wrapper2">
								<AAA_1 ${customId}="aaa2" aAAA_1="second" />
							</AA_1>
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectedId: 'aaa1',
				useTransparentConfig: true,
			},
			{
				description: 'returns undefined when transparent wrapper has no matching child',
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="v">
							<AA_1 ${customId}="aa1" aAA_1="empty-wrapper" />
						</A>
					</Root>
				`,
				parentRef: { tagName: 'A', id: 'a1' },
				childTagName: 'AAA_1',
				expectUndefined: true,
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
				expectUndefined: true,
				useTransparentConfig: false,
			},
		]

		for (const testCase of testCases) {
			it(testCase.description, async () => {
				const { document, cleanup } = await createTestDialecte({
					xmlString: testCase.sourceXml,
					dialecteConfig: testCase.useTransparentConfig
						? configWithTransparent
						: TEST_DIALECTE_CONFIG,
				})

				try {
					const child = await document.query.any.getChild(testCase.parentRef, testCase.childTagName)

					if (testCase.expectUndefined) {
						expect(child).toBeUndefined()
					} else {
						expect(child).toBeDefined()
						expect(child?.id).toBe(testCase.expectedId)
						expect(child?.tagName).toBe(testCase.childTagName)
					}
				} finally {
					await cleanup()
				}
			})
		}
	})
})
