import { actIssue, actThrows, writeAttribute, writeAttributes } from './validate-query.fixtures'
import { SOURCE_XML } from './validate-query.fixtures.constants'

import { describe } from 'vitest'

import { TEST_DIALECTE_CONFIG, runTestCases } from '@/test'

import type { IssueCase, ThrowCase } from './validate-query.fixtures.types'

describe('query.validate.value - attributes', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'attribute with a pattern, a value it refuses → pattern': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'Root' },
						tagName: 'A',
						attribute: 'aA',
						value: 'abc',
					}),
				expected: { reason: 'pattern', actual: 'abc', expected: ['[A-Z]+'], facet: 'pattern' },
			},
			'attribute with an enumeration, a listed value → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'Root' },
						tagName: 'A',
						attribute: 'bA',
						value: 'y',
					}),
			},
			'attribute with a range, above it → range': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'A', id: 'a1' },
						tagName: 'AA_2',
						attribute: 'aAA_2',
						value: ' 150 ',
					}),
				expected: { reason: 'range', actual: '150', expected: '100', facet: 'maxInclusive' },
			},
			'attribute with digits, one fraction digit too many → digits': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						attribute: 'aAAAA_2',
						value: '12.345',
					}),
				expected: { reason: 'digits', actual: '12.345', expected: 2, facet: 'fractionDigits' },
			},
			'plain string attribute → not judged': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'A', id: 'a1' },
						tagName: 'AA_1',
						attribute: 'bAA_1',
						value: ' \t anything ',
					}),
			},
			'the string form is a value-object key: ext:other under an anyAttribute that admits it → not judged':
				{
					sourceXml: SOURCE_XML,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_1',
							attribute: 'ext:other' as 'aAAAA_1',
							value: 'anything',
						}),
				},
			'the write path, the value-object key ext:other → accepted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({
						document,
						tagName: 'AAAA_1',
						attributes: { aAAAA_1: 'x', 'ext:other': 'anything' },
					}),
			},
			'the string form, ext:aAAAA_3 (a table prefix, declared) → judged: the length issue': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_3' as 'AAAA_1',
						attribute: 'ext:aAAAA_3' as 'aAAAA_1',
						value: 'short',
					}),
				expected: { reason: 'length', actual: 'short', expected: 8, facet: 'length' },
			},
			'the write path, the value-object key ext:aAAAA_3 → accepted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({ document, tagName: 'AAAA_3', attributes: { 'ext:aAAAA_3': 'short' } }),
			},
			'the canonical object form (prefixed name, its Namespace object) → judged': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_3' as 'AAAA_1',
						attribute: {
							name: 'ext:aAAAA_3',
							namespace: { prefix: 'ext', uri: `${TEST_DIALECTE_CONFIG.namespaces.ext.uri}` },
						},
						value: 'short',
					}),
				expected: { reason: 'length', actual: 'short', expected: 8, facet: 'length' },
			},
			'the write path accepts the canonical object form': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttribute({
						document,
						tagName: 'AAAA_3',
						attribute: {
							name: 'ext:aAAAA_3',
							value: 'short',
							namespace: { prefix: 'ext', uri: `${TEST_DIALECTE_CONFIG.namespaces.ext.uri}` },
						},
					}),
			},
			'the object form, a config key (ext) → judged': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_3' as 'AAAA_1',
						attribute: { name: 'aAAAA_3', namespace: 'ext' },
						value: 'short',
					}),
				expected: { reason: 'length', actual: 'short', expected: 8, facet: 'length' },
			},
			'the write path accepts the config-key object form': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttribute({
						document,
						tagName: 'AAAA_3',
						attribute: { name: 'aAAAA_3', value: 'short', namespace: 'ext' },
					}),
			},
			'the object form, a namespace object the dialecte does not declare, under a lax ##other wildcard → not judged':
				{
					sourceXml: SOURCE_XML,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_1',
							attribute: { name: 'any', namespace: { prefix: 'foo', uri: 'urn:foo' } },
							value: 'anything',
						}),
				},
			'the write path accepts that namespace object': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttribute({
						document,
						tagName: 'AAAA_1',
						attribute: {
							name: 'any',
							value: 'anything',
							namespace: { prefix: 'foo', uri: 'urn:foo' },
						},
					}),
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - attributes, refused', () => {
	runTestCases.withoutExport<ThrowCase>({
		testCases: {
			'the string form, foo:any (a prefix the dialecte does not declare) → UNKNOWN_NAMESPACE_PREFIX':
				{
					sourceXml: SOURCE_XML,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_1',
							attribute: 'foo:any' as 'aAAAA_1',
							value: 'anything',
						}),
					expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
				},
			'the write path, the value-object key foo:any → UNKNOWN_NAMESPACE_PREFIX': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({
						document,
						tagName: 'AAAA_1',
						attributes: { aAAAA_1: 'x', 'foo:any': 'anything' },
					}),
				expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
			},
			'the string form, nowhere:any → UNKNOWN_NAMESPACE_PREFIX': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_1',
						attribute: 'nowhere:any' as 'aAAAA_1',
						value: 'anything',
					}),
				expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
			},
			'the write path, the value-object key nowhere:any → UNKNOWN_NAMESPACE_PREFIX': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({
						document,
						tagName: 'AAAA_1',
						attributes: { aAAAA_1: 'x', 'nowhere:any': 'anything' },
					}),
				expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
			},
			'the object form, a prefixed local name its namespace does not back (ext:aAAAA_3, key ext) → PREFIXED_ATTRIBUTE_NAME':
				{
					sourceXml: SOURCE_XML,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_3' as 'AAAA_1',
							attribute: { name: 'ext:aAAAA_3', namespace: 'ext' },
							value: 'short',
						}),
					expectedError: 'PREFIXED_ATTRIBUTE_NAME',
				},
			'the write path, the same full object → PREFIXED_ATTRIBUTE_NAME': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({
						document,
						tagName: 'AAAA_3',
						attributes: [{ name: 'ext:aAAAA_3', value: 'short', namespace: 'ext' }],
					}),
				expectedError: 'PREFIXED_ATTRIBUTE_NAME',
			},
			'the object form, a prefixed local name with a key bound nowhere (foo:any) → PREFIXED_ATTRIBUTE_NAME':
				{
					sourceXml: SOURCE_XML,
					check: (document) =>
						document.query.validate.value({
							parent: { tagName: 'AAA_1', id: 'aaa1' },
							tagName: 'AAAA_1',
							attribute: { name: 'foo:any', namespace: 'ext' },
							value: 'anything',
						}),
					expectedError: 'PREFIXED_ATTRIBUTE_NAME',
				},
			'the write path, the same full object (foo:any) → PREFIXED_ATTRIBUTE_NAME': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttributes({
						document,
						tagName: 'AAAA_1',
						attributes: [{ name: 'foo:any', value: 'anything', namespace: 'ext' }],
					}),
				expectedError: 'PREFIXED_ATTRIBUTE_NAME',
			},
			'the object form, a key the dialecte does not know → UNKNOWN_NAMESPACE_PREFIX': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_1',
						attribute: { name: 'any', namespace: 'nope' },
						value: 'anything',
					}),
				expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
			},
			'the write path, the same key → UNKNOWN_NAMESPACE_PREFIX': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					writeAttribute({
						document,
						tagName: 'AAAA_1',
						attribute: { name: 'any', value: 'anything', namespace: 'nope' },
					}),
				expectedError: 'UNKNOWN_NAMESPACE_PREFIX',
			},
			'attribute of a table prefix no declaration and no wildcard admits → INVALID_ATTRIBUTE': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_2',
						attribute: 'ext:zzz' as 'aAAAA_2',
						value: 'anything',
					}),
				expectedError: 'INVALID_ATTRIBUTE',
			},

			'undeclared attribute → INVALID_ATTRIBUTE': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'Root' },
						tagName: 'A',
						attribute: 'zA' as 'aA',
						value: 'X',
					}),
				expectedError: 'INVALID_ATTRIBUTE',
			},
			'unqualified attribute an anyAttribute of ##other refuses → INVALID_ATTRIBUTE': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'AAA_1', id: 'aaa1' },
						tagName: 'AAAA_1',
						attribute: 'other' as 'aAAAA_1',
						value: 'anything',
					}),
				expectedError: 'INVALID_ATTRIBUTE',
			},
			'a child the parent cannot hold → INVALID_PARENT_CHILD': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'Root' },
						tagName: 'AA_1' as 'A',
						value: 'x',
					}),
				expectedError: 'INVALID_PARENT_CHILD',
			},
			'a parent that does not exist → ELEMENT_NOT_FOUND': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'A', id: 'missing' },
						tagName: 'AA_2',
						attribute: 'aAA_2',
						value: '1',
					}),
				expectedError: 'ELEMENT_NOT_FOUND',
			},
		},
		act: actThrows,
	})
})
