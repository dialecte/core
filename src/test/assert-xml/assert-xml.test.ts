import { DIALECTE_TEST_NAMESPACES } from '../constant'
import { createXmlAssertions } from './assert-xml'

import { describe, it, expect } from 'vitest'

const DEFAULT_NS_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_NS_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const EXT_PREFIX = DIALECTE_TEST_NAMESPACES.ext.prefix

// Uses the core test definition structure:
// Root > A > AA_1 > AAA_1 > AAAA_1 (leaf)
// _3 elements and c-prefixed attributes use ext namespace
const sampleXml = /* xml */ `
	<Root xmlns="${DEFAULT_NS_URI}" xmlns:${EXT_PREFIX}="${EXT_NS_URI}" root="1">
		<A aA="valA">
			<AA_1 aAA_1="v1">
				<AAA_1 aAAA_1="deep1">
					<AAAA_1 aAAAA_1="leaf1" />
					<AAAA_2 aAAAA_2="leaf2" />
				</AAA_1>
			</AA_1>
			<AA_2 aAA_2="v2" />
			<${EXT_PREFIX}:AA_3 ${EXT_PREFIX}:aAA_3="v3" />
		</A>
		<B aB="valB">
			<BB_1 aBB_1="b1">
				<BBB_1 aBBB_1="bb1" />
				<BBB_1 aBBB_1="bb1-dup" />
			</BB_1>
		</B>
	</Root>
`

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_TEST_NAMESPACES,
})

describe('assertXml', () => {
	it('passes for existing descendant chain', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: [
				'//default:A[@aA="valA"]//default:AAA_1[@aAAA_1="deep1"]//default:AAAA_1[@aAAAA_1="leaf1"]',
			],
		})
	})

	it('passes for direct child path', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:Root[@root="1"]/default:A[@aA="valA"]/default:AA_1[@aAA_1="v1"]'],
		})
	})

	it('passes for ext namespace elements', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:A[@aA="valA"]/ext:AA_3[@ext:aAA_3="v3"]'],
		})
	})

	it('passes for multiple independent queries', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: [
				'//default:A[@aA="valA"]',
				'//default:AAAA_1[@aAAAA_1="leaf1"]',
				'//default:B[@aB="valB"]',
			],
		})
	})

	it('namespace declarations are not attributes → @* counts the attributes only', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:Root[count(@*) = 1][@root="1"]', '//default:A[count(@*) = 1]'],
		})
	})

	it('handles positional predicate', () => {
		assertExpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:BB_1[@aBB_1="b1"]/default:BBB_1[2]'],
		})
	})
})

describe('assertXmlAbsent', () => {
	it('passes when element does not exist', () => {
		assertUnexpectedElementQueries({ xml: sampleXml, queries: ['//default:A[@aA="NONEXISTENT"]'] })
	})

	it('passes for non-existing child relationship (ancestors exist)', () => {
		// AA_1 is child of A, not of Root directly
		assertUnexpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:Root[@root="1"]/default:AA_1[@aAA_1="v1"]'],
		})
	})

	it('a namespace declaration is no attribute → not found on the attribute axis', () => {
		assertUnexpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:Root[@*[local-name() = "xmlns" or starts-with(name(), "xmlns:")]]'],
		})
	})

	it('works with following-sibling axis', () => {
		// Only one A element, so no following-sibling A
		assertUnexpectedElementQueries({
			xml: sampleXml,
			queries: ['//default:A[@aA="valA"]/following-sibling::default:A'],
		})
	})

	it('passes with multi-step where ancestors exist but target absent', () => {
		assertUnexpectedElementQueries({
			xml: sampleXml,
			queries: [
				'//default:A[@aA="valA"]//default:AA_1[@aAA_1="v1"]//default:AAA_1[@aAAA_1="NONEXISTENT"]',
			],
		})
	})
})
