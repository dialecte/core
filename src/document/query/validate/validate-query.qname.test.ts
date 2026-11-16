import { actIssue, storeReads, withQNameAAAA_2 } from './validate-query.fixtures'
import { customId, ns } from './validate-query.fixtures.constants'

import { describe, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, createTestRunner } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'

describe("query.validate.value - a QName value read as a write reads it: the dialecte's prefixes or a Clark name", () => {
	// AAAA_2.aAAAA_2 is a QName that must be {ext}x
	const dialecteConfig = withQNameAAAA_2({
		enumeration: [`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`],
	})
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
				</AA_1>
			</A>
		</Root>
	`

	function check(value: string): IssueCase['check'] {
		return (document) =>
			document.query.validate.value({
				parent: { tagName: 'AAA_1', id: 'aaa1' },
				tagName: 'AAAA_2',
				attribute: 'aAAAA_2',
				value,
			})
	}

	createTestRunner({ dialecteConfig }).withoutExport<IssueCase>({
		dev: { perf: true },
		testCases: {
			'a config prefix (ext) → judged, admitted': { sourceXml, check: check('ext:x') },
			'a config prefix (ext) → judged, refused by the enumeration': {
				sourceXml,
				check: check('ext:y'),
				expected: {
					reason: 'enumeration',
					actual: 'ext:y',
					expected: [`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`],
					facet: 'enumeration',
				},
			},
			'the Clark form of the enumerated name → judged, admitted': {
				sourceXml,
				check: check(`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`),
			},
			'a foreign Clark name → judged, refused by the enumeration': {
				sourceXml,
				check: check('{urn:f}x'),
				expected: {
					reason: 'enumeration',
					actual: '{urn:f}x',
					expected: [`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`],
					facet: 'enumeration',
				},
			},
			'a Clark name in no namespace ({}x) → judged, refused by the enumeration': {
				sourceXml,
				check: check('{}x'),
				expected: {
					reason: 'enumeration',
					actual: '{}x',
					expected: [`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`],
					facet: 'enumeration',
				},
			},
			'a lone brace → datatype (QName)': {
				sourceXml,
				check: check('{'),
				expected: { reason: 'datatype', actual: '{', expected: 'QName' },
			},
			'a braced name followed by a space and another name → datatype (QName)': {
				sourceXml,
				check: check('{a}b c'),
				expected: { reason: 'datatype', actual: '{a}b c', expected: 'QName' },
			},
			'empty braces → datatype (QName)': {
				sourceXml,
				check: check('{}'),
				expected: { reason: 'datatype', actual: '{}', expected: 'QName' },
			},
			'the xml prefix → judged (always bound), refused by the enumeration': {
				sourceXml,
				check: check('xml:x'),
				expected: {
					reason: 'enumeration',
					actual: 'xml:x',
					expected: [`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`],
					facet: 'enumeration',
				},
			},
			'a prefix bound on the parent in the XML only → datatype (QName): records hold no declaration':
				{
					sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="X">
							<AA_1 ${customId}="aa1" aAA_1="n">
								<AAA_1 ${customId}="aaa1" aAAA_1="abc" xmlns:g="urn:two" />
							</AA_1>
						</A>
					</Root>
				`,
					check: check('g:x'),
					expected: { reason: 'datatype', actual: 'g:x', expected: 'QName' },
				},
			'a prefix bound on the grandparent in the XML only → datatype (QName)': {
				sourceXml: /* xml */ `
					<Root ${ns}>
						<A ${customId}="a1" aA="X">
							<AA_1 ${customId}="aa1" aAA_1="n" xmlns:h="urn:two">
								<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
							</AA_1>
						</A>
					</Root>
				`,
				check: check('h:x'),
				expected: { reason: 'datatype', actual: 'h:x', expected: 'QName' },
			},
			'a prefix bound on the root in the XML only → datatype (QName)': {
				sourceXml: /* xml */ `
					<Root ${ns} xmlns:r="urn:two">
						<A ${customId}="a1" aA="X">
							<AA_1 ${customId}="aa1" aAA_1="n">
								<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
							</AA_1>
						</A>
					</Root>
				`,
				check: check('r:x'),
				expected: { reason: 'datatype', actual: 'r:x', expected: 'QName' },
			},
			'a QName whose prefix the dialecte does not declare → datatype (QName), as a write refuses it':
				{
					sourceXml,
					// refused on the parent read alone: no ancestor is walked for a binding
					check: async (document) => {
						document.perf.reset()
						const issue = await check('z:x')(document)
						expect(storeReads(document)).toBe(1)
						return issue
					},
					expected: { reason: 'datatype', actual: 'z:x', expected: 'QName' },
				},
			'two colons, a prefix the dialecte does not declare → datatype (QName)': {
				sourceXml,
				check: check('zz:b:c'),
				expected: { reason: 'datatype', actual: 'zz:b:c', expected: 'QName' },
			},
			'a prefix starting with a digit, the dialecte does not declare → datatype (QName)': {
				sourceXml,
				check: check('1zz:x'),
				expected: { reason: 'datatype', actual: '1zz:x', expected: 'QName' },
			},
		},
		act: actIssue,
	})
})

describe('query.validate.value - an unprefixed QName is the dialecte default namespace, no walk', () => {
	const defaultUri = TEST_DIALECTE_CONFIG.namespaces.default.uri
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<A ${customId}="a1" aA="X">
				<AA_1 ${customId}="aa1" aAA_1="n">
					<AAA_1 ${customId}="aaa1" aAAA_1="abc" />
				</AA_1>
			</A>
		</Root>
	`
	function check(value: string): IssueCase['check'] {
		return async (document) => {
			document.perf.reset()
			const issue = await document.query.validate.value({
				parent: { tagName: 'AAA_1', id: 'aaa1' },
				tagName: 'AAAA_2',
				attribute: 'aAAAA_2',
				value,
			})
			const reads = storeReads(document)
			expect(reads).toBe(1)
			return issue
		}
	}

	createTestRunner({
		dialecteConfig: withQNameAAAA_2({ enumeration: [`{${defaultUri}}x`] }),
	}).withoutExport<IssueCase>({
		dev: { perf: true },
		testCases: {
			'enumerated in the default namespace, the value unprefixed → admitted, the parent read alone':
				{
					sourceXml,
					check: check('x'),
				},
		},
		act: actIssue,
	})

	createTestRunner({
		dialecteConfig: withQNameAAAA_2({ enumeration: ['x'] }),
	}).withoutExport<IssueCase>({
		dev: { perf: true },
		testCases: {
			'enumerated in no namespace, the value unprefixed → enumeration (it is in the default namespace)':
				{
					sourceXml,
					check: check('x'),
					expected: { reason: 'enumeration', actual: 'x', expected: ['x'], facet: 'enumeration' },
				},
		},
		act: actIssue,
	})
})

describe('query.validate.value - a union with a QName member: the first member that reads the value', () => {
	// EE_2.aEE_2 is a union of xs:integer and xs:QName
	const sourceXml = /* xml */ `
		<Root ${ns}>
			<E ${customId}="e" aE="e"><EE_1 aEE_1="Thing" /></E>
		</Root>
	`

	function check(value: string): IssueCase['check'] {
		return (document) =>
			document.query.validate.value({
				parent: { tagName: 'E', id: 'e' },
				tagName: 'EE_2',
				attribute: 'aEE_2',
				value,
			})
	}

	createTestRunner({ dialecteConfig: TEST_DIALECTE_CONFIG }).withoutExport<IssueCase>({
		testCases: {
			'an integer → admitted': { sourceXml, check: check('12') },
			'a QName of a config prefix → admitted': { sourceXml, check: check('ext:x') },
			'a foreign Clark name → admitted': { sourceXml, check: check('{urn:f}x') },
			'a QName whose prefix the dialecte does not declare → datatype with the members': {
				sourceXml,
				check: check('z:x'),
				expected: { reason: 'datatype', actual: 'z:x', expected: ['integer', 'QName'] },
			},
		},
		act: actIssue,
	})
})
