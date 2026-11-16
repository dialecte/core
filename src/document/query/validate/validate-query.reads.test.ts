import { actIssue, storeReads, withQNameAAAA_2, writeAttributes } from './validate-query.fixtures'
import { SOURCE_XML, customId, ns } from './validate-query.fixtures.constants'

import { describe, expect } from 'vitest'

import { XML_NAMESPACE_URI } from '@/helpers'
import { TEST_DIALECTE_CONFIG, createTestRunner } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'

describe('query.validate.value - the xml prefix is always bound', () => {
	createTestRunner({ dialecteConfig: TEST_DIALECTE_CONFIG }).withoutExport<IssueCase>({
		dev: { perf: true },
		testCases: {
			'xml:lang an anyAttribute of ##other admits, bound nowhere in the document → not judged, the parent read alone':
				{
					sourceXml: SOURCE_XML,
					check: async (document) => {
						document.perf.reset()
						const issue = await document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_1',
							attribute: 'xml:lang' as 'aAAAA_1',
							value: 'en',
						})
						expect(storeReads(document)).toBe(1)
						return issue
					},
				},
			'the write path, the value-object key xml:lang → accepted, stored in the XML namespace': {
				sourceXml: SOURCE_XML,
				check: async (document) => {
					await writeAttributes({
						document,
						tagName: 'AAAA_1',
						attributes: { aAAAA_1: 'x', 'xml:lang': 'en' },
					})
					const [record] = await document.query.getRecordsByTagName('AAAA_1')
					const attributes = (record?.attributes ?? []) as {
						name: string
						value: unknown
						namespace?: { uri: string }
					}[]
					const lang = attributes.find(
						(attribute) => attribute.name === 'xml:lang' || attribute.name === 'lang',
					)
					expect({ value: lang?.value, namespace: lang?.namespace?.uri }).toEqual({
						value: 'en',
						namespace: XML_NAMESPACE_URI,
					})
					return undefined
				},
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - one read: the parent', () => {
	const dialecteConfig = withQNameAAAA_2()
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
				</AA_1>
			</A>
		</Root>
	`

	function check(params: {
		value: string
		attribute?: string
		xsiType?: string
	}): IssueCase['check'] {
		return async (document) => {
			document.perf.reset()
			const issue = await document.query.validate.value({
				parent: { tagName: 'AAA_1', id: 'aaa1' },
				tagName: 'AAAA_2',
				attribute: (params.attribute ?? 'aAAAA_2') as 'aAAAA_2',
				...(params.xsiType ? { xsiType: params.xsiType } : {}),
				value: params.value,
			})
			expect(storeReads(document)).toBe(1)
			return issue
		}
	}

	createTestRunner({ dialecteConfig }).withoutExport<IssueCase>({
		dev: { perf: true },
		testCases: {
			'a QName with a config prefix → 1 read': { sourceXml, check: check({ value: 'ext:x' }) },
			'a QName whose prefix the dialecte does not declare → 1 read': {
				sourceXml,
				check: check({ value: 'g:x' }),
			},
			'an xsi:type value with xs from the engine table → 1 read': {
				sourceXml: SOURCE_XML,
				check: async (document) => {
					document.perf.reset()
					const issue = await document.query.validate.value({
						parent: { tagName: 'DD_2', id: 'dd2' },
						tagName: 'DDD_2',
						attribute: 'xsi:type',
						value: 'xs:string',
					})
					expect(storeReads(document)).toBe(1)
					return issue
				},
			},
			'an xsi:type value with an unbound prefix → 1 read': {
				sourceXml,
				check: check({ value: 'nowhere:integer', attribute: 'xsi:type' }),
				expected: { reason: 'datatype', actual: 'nowhere:integer', expected: 'QName' },
			},
			'a wildcard attribute (xml:lang) → 1 read': {
				sourceXml,
				check: async (document) => {
					document.perf.reset()
					const issue = await document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_1',
						attribute: 'xml:lang' as 'aAAAA_1',
						value: 'en',
					})
					expect(storeReads(document)).toBe(1)
					return issue
				},
			},
		},
		act: actIssue,
	})
})
