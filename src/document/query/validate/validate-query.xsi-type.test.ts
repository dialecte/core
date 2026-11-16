import { actIssue, actThrows } from './validate-query.fixtures'
import { SOURCE_XML, customId, ns } from './validate-query.fixtures.constants'

import { describe } from 'vitest'

import { XSD_NAMESPACE_URI } from '@/helpers'
import { TEST_DIALECTE_CONFIG, createTestRunner, runTestCases } from '@/test'

import type { IssueCase, ThrowCase } from './validate-query.fixtures.types'
import type { TestDialecteConfig } from '@/test'

describe('query.validate.value - xsi:type', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'a variant of the abstract type → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'tDD_1A',
					}),
			},
			'a variant in the ext namespace → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'ext:tDD_1C',
					}),
			},
			'a prefix only the XML text binds on the parent (q) → datatype (QName)': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<D ${customId}="d1" aD="d" xmlns:q="${TEST_DIALECTE_CONFIG.namespaces.default.uri}" />
					</Root>
				`,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'q:tDD_1B',
					}),
				expected: { reason: 'datatype', actual: 'q:tDD_1B', expected: 'QName' },
			},
			'a prefix bound on the root only (r, not declared by the dialecte) → datatype (QName)': {
				sourceXml: /* xml */ `
					<Root ${ns} xmlns:r="${TEST_DIALECTE_CONFIG.namespaces.default.uri}">
						<D ${customId}="d1" aD="d" />
					</Root>
				`,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'r:tDD_1B',
					}),
				expected: { reason: 'datatype', actual: 'r:tDD_1B', expected: 'QName' },
			},
			'the abstract type itself → datatype with the admitted types': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'tDD_1',
					}),
				expected: {
					reason: 'datatype',
					actual: 'tDD_1',
					expected: TEST_DIALECTE_CONFIG.definition.DD_1.variants,
				},
			},
			'a prefix bound nowhere → datatype (QName)': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'xsi:type',
						value: 'nowhere:tDD_1A',
					}),
				expected: { reason: 'datatype', actual: 'nowhere:tDD_1A', expected: 'QName' },
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - xsi:type against the declared type', () => {
	const DD_2 = TEST_DIALECTE_CONFIG.definition.DD_2
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'a built-in on a complex-typed element → datatype with the admitted types': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_2',
						attribute: 'xsi:type',
						value: 'xs:string',
					}),
				expected: {
					reason: 'datatype',
					actual: 'xs:string',
					expected: [DD_2.type, ...DD_2.variants],
				},
			},
			'anyType on a complex-typed element → datatype with the admitted types': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_2',
						attribute: 'xsi:type',
						value: 'xs:anyType',
					}),
				expected: {
					reason: 'datatype',
					actual: 'xs:anyType',
					expected: [DD_2.type, ...DD_2.variants],
				},
			},
			'an extension of the declared complex type → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_2',
						attribute: 'xsi:type',
						value: 'tDD_2A',
					}),
			},
			'a built-in on an element of no type (anyType), xs from the engine table → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'DD_2', id: 'dd2' },
						tagName: 'DDD_2',
						attribute: 'xsi:type',
						value: 'xs:string',
					}),
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - the xsi:type of the child', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'an attribute only the named variant declares → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						xsiType: 'tDD_1A',
						attribute: 'dDD_1',
						value: 'x',
					}),
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - the xsi:type of the child, refused', () => {
	runTestCases.withoutExport<ThrowCase>({
		testCases: {
			'the same attribute, no xsi:type given → INVALID_ATTRIBUTE': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'D', id: 'd1' },
						tagName: 'DD_1',
						attribute: 'dDD_1',
						value: 'x',
					}),
				expectedError: 'INVALID_ATTRIBUTE',
			},
		},
		act: actThrows,
	})
})

describe('query.validate.value - the text under a built-in xsi:type', () => {
	// AAAA_2 declared with the built-in type xs:decimal, its text a decimal
	const { definition } = TEST_DIALECTE_CONFIG
	const dialecteConfig = {
		...TEST_DIALECTE_CONFIG,
		definition: {
			...definition,
			AAAA_2: {
				...definition.AAAA_2,
				type: `{${XSD_NAMESPACE_URI}}decimal`,
				textContent: { type: { builtin: 'decimal' } },
			},
		},
	} as unknown as TestDialecteConfig
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
				</AA_1>
			</A>
		</Root>
	`

	createTestRunner({ dialecteConfig }).withoutExport<IssueCase>({
		testCases: {
			'a decimal under xsi:type xs:integer on an xs:decimal element → datatype (integer)': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						xsiType: `{${XSD_NAMESPACE_URI}}integer`,
						value: '1.5',
					}),
				expected: { reason: 'datatype', actual: '1.5', expected: 'integer' },
			},
			'a decimal under the param xsiType xs:integer (prefixed, xs from the table) → datatype (integer)':
				{
					sourceXml,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_2',
							xsiType: 'xs:integer',
							value: '1.5',
						}),
					expected: { reason: 'datatype', actual: '1.5', expected: 'integer' },
				},
			'the xsiType param with a prefix the table does not bind → datatype (QName)': {
				sourceXml,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						xsiType: 'r:integer',
						value: '1',
					}),
				expected: { reason: 'datatype', actual: 'r:integer', expected: 'QName' },
			},
		},
		act: actIssue,
	})
})
