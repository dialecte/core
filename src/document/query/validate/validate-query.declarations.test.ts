import { actIssue } from './validate-query.fixtures'
import { customId, ns } from './validate-query.fixtures.constants'

import { describe } from 'vitest'

import { XSD_NAMESPACE_URI } from '@/helpers'
import { TEST_DIALECTE_CONFIG, createTestRunner } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'
import type { TestDialecteConfig } from '@/test'
import type { AnyTypes, DeclarationDefinition, ElementDefinition } from '@/types'

describe('query.validate.value - a child declared differently under two parents', () => {
	// AAAA_2 declared two ways: under AAA_1 its aAAAA_2 is a decimal of two fraction digits, under AAA_2 an
	// integer up to 9
	const definition = TEST_DIALECTE_CONFIG.definition
	const defaultUri = TEST_DIALECTE_CONFIG.namespaces.default.uri
	const underAaa1: DeclarationDefinition = definition.AAAA_2
	const underAaa2: DeclarationDefinition = {
		...definition.AAAA_2,
		attributes: {
			...definition.AAAA_2.attributes,
			details: {
				...definition.AAAA_2.attributes.details,
				aAAAA_2: { required: true, type: { builtin: 'integer', facets: { maxInclusive: '9' } } },
			},
		},
	}
	function holding(params: { parent: ElementDefinition; declaration: string }): ElementDefinition {
		const { parent, declaration } = params
		return {
			...parent,
			children: {
				...parent.children,
				details: { AAAA_2: { declarations: { [defaultUri]: [declaration] } } },
			},
		}
	}
	const dialecteConfig = {
		...TEST_DIALECTE_CONFIG,
		definition: {
			...definition,
			AAAA_2: { ...definition.AAAA_2, declarations: { '1': underAaa1, '2': underAaa2 } },
			AAA_1: holding({ parent: definition.AAA_1, declaration: '1' }),
			AAA_2: holding({ parent: definition.AAA_2, declaration: '2' }),
		},
	} as unknown as TestDialecteConfig
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
					<AAA_2 ${customId}="aaa2" aAAA_2="abc" />
				</AA_1>
			</A>
		</Root>
	`

	createTestRunner({ dialecteConfig }).withoutExport<IssueCase>({
		testCases: {
			'under the first parent, a decimal → admitted': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						attribute: 'aAAAA_2',
						value: '12.34',
					}),
			},
			'under the second parent, the same decimal → datatype (integer)': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_2', id: 'aaa2' },
						tagName: 'AAAA_2',
						attribute: 'aAAAA_2',
						value: '12.34',
					}),
				expected: { reason: 'datatype', actual: '12.34', expected: 'integer' },
			},
			'under the second parent, above its maximum → range': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_2', id: 'aaa2' },
						tagName: 'AAAA_2',
						attribute: 'aAAAA_2',
						value: '10',
					}),
				expected: { reason: 'range', actual: '10', expected: '9', facet: 'maxInclusive' },
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - a variant with facets of its own, a built-in declared type', () => {
	// tDD_1A's dDD_1 only digits; AAAA_2 declared with the built-in type xs:decimal
	const { definition, types } = TEST_DIALECTE_CONFIG
	const tDD_1A = `{${TEST_DIALECTE_CONFIG.namespaces.default.uri}}tDD_1A`
	const variant = (types as AnyTypes)[tDD_1A]
	const dialecteConfig = {
		...TEST_DIALECTE_CONFIG,
		types: {
			...types,
			[tDD_1A]: {
				...variant,
				attributes: {
					...variant.attributes,
					details: {
						...variant.attributes.details,
						dDD_1: {
							required: true,
							type: { builtin: 'string', facets: { pattern: [['[0-9]+']] } },
						},
					},
				},
			},
		},
		definition: {
			...definition,
			AAAA_2: { ...definition.AAAA_2, type: `{${XSD_NAMESPACE_URI}}decimal` },
		},
	} as unknown as TestDialecteConfig
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
				</AA_1>
			</A>
			<D ${customId}="d1" aD="d" />
		</Root>
	`

	createTestRunner({ dialecteConfig }).withoutExport<IssueCase>({
		testCases: {
			'a facet only the named variant declares → its issue': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						xsiType: 'tDD_1A',
						attribute: 'dDD_1',
						value: 'x',
					}),
				expected: { reason: 'pattern', actual: 'x', expected: ['[0-9]+'], facet: 'pattern' },
			},
			'a built-in derived from the declared built-in → admitted': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						// the generated attributes of AAAA_2 carry no xsi:type: its real declaration has no variant
						attribute: 'xsi:type' as 'aAAAA_2',
						value: 'xs:integer',
					}),
			},
			'the Clark form of a built-in derived from the declared built-in → admitted': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						// the generated attributes of AAAA_2 carry no xsi:type: its real declaration has no variant
						attribute: 'xsi:type' as 'aAAAA_2',
						value: `{${XSD_NAMESPACE_URI}}integer`,
					}),
			},
			'a built-in not derived from the declared built-in → datatype': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						// the generated attributes of AAAA_2 carry no xsi:type: its real declaration has no variant
						attribute: 'xsi:type' as 'aAAAA_2',
						value: 'xs:string',
					}),
				expected: {
					reason: 'datatype',
					actual: 'xs:string',
					expected: [`{${XSD_NAMESPACE_URI}}decimal`],
				},
			},
		},
		act: actIssue,
	})
})
