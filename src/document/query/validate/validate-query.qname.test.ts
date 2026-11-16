import { actIssue, storeReads, withQNameAAAA_2 } from './validate-query.fixtures'
import { customId, ns } from './validate-query.fixtures.constants'

import { describe, expect } from 'vitest'

import { TEST_DIALECTE_CONFIG, createTestRunner } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'

describe("query.validate.value - a QName value: the dialecte's prefixes only, another prefix not judged yet", () => {
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
			'the Clark form → datatype (QName), only an xsi:type value reads a Clark name': {
				sourceXml,
				check: check(`{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`),
				expected: {
					reason: 'datatype',
					actual: `{${TEST_DIALECTE_CONFIG.namespaces.ext.uri}}x`,
					expected: 'QName',
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
			'a prefix bound on the parent in the XML only → not judged (records hold no declaration)': {
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
			},
			'a prefix bound on the grandparent in the XML only → not judged': {
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
			},
			'a prefix bound on the root in the XML only → not judged': {
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
			},
			'a QName whose prefix the dialecte does not declare → not judged yet': {
				sourceXml,
				check: check('z:x'),
			},
			'two colons, a prefix the dialecte does not declare → datatype (QName), no QName to leave unjudged':
				{
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
