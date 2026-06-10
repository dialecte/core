import { buildXmlDocument } from './build-xml-document'
import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'

import { describe, expect } from 'vitest'

import { DIALECTE_TEST_NAMESPACES, runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { BaseTestCase } from '@/test'
import type { AnyRawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const NS = DIALECTE_TEST_NAMESPACES
const CONFIG = TEST_DIALECTE_CONFIG

function record(
	overrides: Partial<AnyRawRecord> & Pick<AnyRawRecord, 'id' | 'tagName'>,
): AnyRawRecord {
	return {
		namespace: NS.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
		...overrides,
	}
}

function serialize(xmlDocument: XMLDocument): string {
	return new XMLSerializer().serializeToString(xmlDocument)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildXmlDocument', () => {
	describe('basic structure', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			assertions: (xmlDocument: XMLDocument) => void
		}

		const testCases: Record<string, TestCase> = {
			'root-only document': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [{ name: 'root', value: '1' }],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					expect(root.tagName).toBe('Root')
					expect(root.getAttribute('xmlns')).toBe(NS.default.uri)
					expect(root.getAttribute('root')).toBe('1')
				},
			},
			'root with one child': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'hello' }],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					expect(root.children).toHaveLength(1)
					expect(root.children[0].tagName).toBe('A')
					expect(root.children[0].getAttribute('aA')).toBe('hello')
				},
			},
			'nested children (3 levels)': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'val' }],
						children: [{ id: 'aa1-1', tagName: 'AA_1' }],
					}),
					record({
						id: 'aa1-1',
						tagName: 'AA_1',
						parent: { id: 'a-1', tagName: 'A' },
						attributes: [{ name: 'aAA_1', value: 'deep' }],
					}),
				],
				assertions: (doc) => {
					const aa1 = doc.documentElement.querySelector('A > AA_1')
					expect(aa1).not.toBeNull()
					expect(aa1!.getAttribute('aAA_1')).toBe('deep')
				},
			},
			'text content preserved': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
						children: [{ id: 'aa1-1', tagName: 'AA_1' }],
					}),
					record({
						id: 'aa1-1',
						tagName: 'AA_1',
						parent: { id: 'a-1', tagName: 'A' },
						attributes: [{ name: 'aAA_1', value: 'x' }],
						value: '  some text  ',
					}),
				],
				assertions: (doc) => {
					const aa1 = doc.documentElement.querySelector('AA_1')
					expect(aa1!.textContent).toBe('some text')
				},
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({ records: tc.records, config: CONFIG })
			tc.assertions(xmlDocument)
		})
	})

	describe('children ordering', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			expectedOrder: string[]
		}

		const testCases: Record<string, TestCase> = {
			'children reordered per config.children sequence': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						// Provided out of order: C, A, B
						children: [
							{ id: 'c-1', tagName: 'C' },
							{ id: 'a-1', tagName: 'A' },
							{ id: 'b-1', tagName: 'B' },
						],
					}),
					record({
						id: 'c-1',
						tagName: 'C',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aC', value: 'x' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
					}),
					record({
						id: 'b-1',
						tagName: 'B',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aB', value: 'x' }],
					}),
				],
				// Config defines Root children: ['A', 'B', 'C']
				expectedOrder: ['A', 'B', 'C'],
			},
			'unknown children appended after known ones': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [
							{ id: 'unknown-1', tagName: 'Unknown' },
							{ id: 'a-1', tagName: 'A' },
						],
					}),
					record({
						id: 'unknown-1',
						tagName: 'Unknown',
						parent: { id: 'root-1', tagName: 'Root' },
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
					}),
				],
				expectedOrder: ['A', 'Unknown'],
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({ records: tc.records, config: CONFIG })
			const children = Array.from(xmlDocument.documentElement.children)
			const tagNames = children.map((el) => el.localName)
			expect(tagNames).toEqual(tc.expectedOrder)
		})
	})

	describe('withDatabaseIds', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			withDatabaseIds: boolean
			expectIdOnRoot: boolean
			expectIdOnChild: boolean
		}

		const testCases: Record<string, TestCase> = {
			'withDatabaseIds=true -> ids stamped on all elements': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
					}),
				],
				withDatabaseIds: true,
				expectIdOnRoot: true,
				expectIdOnChild: true,
			},
			'withDatabaseIds=false -> no ids stamped': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
					}),
				],
				withDatabaseIds: false,
				expectIdOnRoot: false,
				expectIdOnChild: false,
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({
				records: tc.records,
				config: CONFIG,
				withDatabaseIds: tc.withDatabaseIds,
			})
			const root = xmlDocument.documentElement
			const child = root.children[0]

			if (tc.expectIdOnRoot) {
				expect(root.getAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME)).toBe('root-1')
			} else {
				expect(root.hasAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME)).toBe(false)
			}

			if (tc.expectIdOnChild) {
				expect(child.getAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME)).toBe('a-1')
			} else {
				expect(child.hasAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME)).toBe(false)
			}
		})
	})

	describe('namespaced elements and attributes', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			assertions: (xmlDocument: XMLDocument) => void
		}

		const testCases: Record<string, TestCase> = {
			'element in ext namespace -> prefixed and xmlns declared on root': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'aa3-1', tagName: 'AA_3' }],
					}),
					record({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aAA_3', value: 'val' }],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					// xmlns:ext declared on root
					expect(root.getAttributeNS('http://www.w3.org/2000/xmlns/', 'ext')).toBe(NS.ext.uri)
					// Element uses prefixed name
					const extChild = root.children[0]
					expect(extChild.namespaceURI).toBe(NS.ext.uri)
					expect(extChild.prefix).toBe('ext')
				},
			},
			'qualified attribute -> namespace declared and attribute set with prefix': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'a-1', tagName: 'A' }],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [
							{ name: 'aA', value: 'val' },
							{ name: 'cA', value: 'ext-val', namespace: NS.ext },
						],
					}),
				],
				assertions: (doc) => {
					const a = doc.documentElement.children[0]
					expect(a.getAttributeNS(NS.ext.uri, 'cA')).toBe('ext-val')
				},
			},
			'namespace declaration attributes are not rendered as data attributes': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [
							{ name: 'xmlns', value: NS.default.uri },
							{ name: 'xmlns:ext', value: NS.ext.uri },
							{ name: 'root', value: '1' },
						],
					}),
				],
				assertions: (doc) => {
					const xml = serialize(doc)
					// xmlns is set via createElement, should not be duplicated
					const matches = xml.match(/xmlns="/g)
					expect(matches).toHaveLength(1)
				},
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({ records: tc.records, config: CONFIG })
			tc.assertions(xmlDocument)
		})
	})

	describe('enforceRootAttributes', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			assertions: (xmlDocument: XMLDocument) => void
		}

		const testCases: Record<string, TestCase> = {
			'root default attributes enforced when not provided': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						// No attributes provided - enforceRootAttributes should add defaults
						attributes: [],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					// config defines root attr with default '1'
					expect(root.getAttribute('root')).toBe('1')
				},
			},
			'root qualified attributes enforced when ext namespace encountered': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [{ name: 'root', value: '1' }],
						children: [{ id: 'aa3-1', tagName: 'AA_3' }],
					}),
					record({
						id: 'aa3-1',
						tagName: 'AA_3',
						namespace: NS.ext,
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aAA_3', value: 'val' }],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					// ext:root default is '2'
					expect(root.getAttributeNS(NS.ext.uri, 'root')).toBe('2')
				},
			},
			'existing root attribute not overwritten by default': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						attributes: [{ name: 'root', value: 'custom' }],
					}),
				],
				assertions: (doc) => {
					const root = doc.documentElement
					expect(root.getAttribute('root')).toBe('custom')
				},
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({ records: tc.records, config: CONFIG })
			tc.assertions(xmlDocument)
		})
	})

	describe('empty attribute stripping', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			assertions: (xmlDocument: XMLDocument) => void
		}

		const testCases: Record<string, TestCase> = {
			'non-identity empty attribute -> stripped': {
				// BB_2.bBB_2 has default '' and is NOT in identityFields
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'b-1', tagName: 'B' }],
					}),
					record({
						id: 'b-1',
						tagName: 'B',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aB', value: 'x' }],
						children: [{ id: 'bb2-1', tagName: 'BB_2' }],
					}),
					record({
						id: 'bb2-1',
						tagName: 'BB_2',
						parent: { id: 'b-1', tagName: 'B' },
						attributes: [
							{ name: 'aBB_2', value: 'required-val' },
							{ name: 'bBB_2', value: '' }, // empty, not identity -> stripped
						],
					}),
				],
				assertions: (doc) => {
					const bb2 = doc.querySelector('BB_2')
					expect(bb2!.hasAttribute('bBB_2')).toBe(false)
				},
			},
			'identity-field empty attribute -> preserved': {
				// BB_1.bBB_1 has default '' and IS in identityFields
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'b-1', tagName: 'B' }],
					}),
					record({
						id: 'b-1',
						tagName: 'B',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aB', value: 'x' }],
						children: [{ id: 'bb1-1', tagName: 'BB_1' }],
					}),
					record({
						id: 'bb1-1',
						tagName: 'BB_1',
						parent: { id: 'b-1', tagName: 'B' },
						attributes: [
							{ name: 'aBB_1', value: 'required-val' },
							{ name: 'bBB_1', value: '' }, // empty, but identity -> kept
						],
					}),
				],
				assertions: (doc) => {
					const bb1 = doc.querySelector('BB_1')
					expect(bb1!.hasAttribute('bBB_1')).toBe(true)
					expect(bb1!.getAttribute('bBB_1')).toBe('')
				},
			},
			'non-empty attribute -> always preserved': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'b-1', tagName: 'B' }],
					}),
					record({
						id: 'b-1',
						tagName: 'B',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aB', value: 'x' }],
						children: [{ id: 'bb2-1', tagName: 'BB_2' }],
					}),
					record({
						id: 'bb2-1',
						tagName: 'BB_2',
						parent: { id: 'b-1', tagName: 'B' },
						attributes: [
							{ name: 'aBB_2', value: 'req' },
							{ name: 'bBB_2', value: 'non-default-value' },
						],
					}),
				],
				assertions: (doc) => {
					const bb2 = doc.querySelector('BB_2')
					expect(bb2!.getAttribute('bBB_2')).toBe('non-default-value')
				},
			},
			'non-empty attribute matching schema default -> preserved': {
				// BBB_1.bBBB_1 has default 'false' - setting it to 'false' should still preserve it
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [{ id: 'b-1', tagName: 'B' }],
					}),
					record({
						id: 'b-1',
						tagName: 'B',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aB', value: 'x' }],
						children: [{ id: 'bb1-1', tagName: 'BB_1' }],
					}),
					record({
						id: 'bb1-1',
						tagName: 'BB_1',
						parent: { id: 'b-1', tagName: 'B' },
						attributes: [{ name: 'aBB_1', value: 'req' }],
						children: [{ id: 'bbb1-1', tagName: 'BBB_1' }],
					}),
					record({
						id: 'bbb1-1',
						tagName: 'BBB_1',
						parent: { id: 'bb1-1', tagName: 'BB_1' },
						attributes: [
							{ name: 'aBBB_1', value: 'req' },
							{ name: 'bBBB_1', value: 'false' },
						],
					}),
				],
				assertions: (doc) => {
					const bbb1 = doc.querySelector('BBB_1')
					expect(bbb1!.hasAttribute('bBBB_1')).toBe(true)
					expect(bbb1!.getAttribute('bBBB_1')).toBe('false')
				},
			},
		}

		runTestCases.generic(testCases, (tc) => {
			const xmlDocument = buildXmlDocument({ records: tc.records, config: CONFIG })
			tc.assertions(xmlDocument)
		})
	})

	describe('error cases', () => {
		type TestCase = BaseTestCase & {
			records: AnyRawRecord[]
			expectedError: string
		}

		const testCases: Record<string, TestCase> = {
			'no root element -> EXPORT_ROOT_NOT_FOUND': {
				records: [
					record({
						id: 'a-1',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'x' }],
					}),
				],
				expectedError: 'No Root root element found in records',
			},
			'orphan child reference -> EXPORT_ORPHAN_CHILD_REF': {
				records: [
					record({
						id: 'root-1',
						tagName: 'Root',
						children: [
							{ id: 'a-1', tagName: 'A' },
							{ id: 'missing-id', tagName: 'B' },
						],
					}),
					record({
						id: 'a-1',
						tagName: 'A',
						parent: { id: 'root-1', tagName: 'Root' },
						attributes: [{ name: 'aA', value: 'x' }],
					}),
					// 'missing-id' intentionally not in records
				],
				expectedError: "Parent 'Root' references non-existent child 'B' (id: missing-id)",
			},
		}

		runTestCases.generic(testCases, (tc) => {
			expect(() => buildXmlDocument({ records: tc.records, config: CONFIG })).toThrowError(
				tc.expectedError,
			)
		})
	})
})
