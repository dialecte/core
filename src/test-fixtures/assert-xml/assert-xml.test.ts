import { DIALECTE_NAMESPACES } from '../constant'
import { createXmlAssertions } from './assert-xml'

import { describe, it, expect } from 'vitest'

const DEFAULT_NS_URI = DIALECTE_NAMESPACES.default.uri
const EXT_NS_URI = DIALECTE_NAMESPACES.ext.uri
const EXT_PREFIX = DIALECTE_NAMESPACES.ext.prefix

function parseXml(xml: string): XMLDocument {
	const parser = new DOMParser()
	return parser.parseFromString(xml, 'application/xml')
}

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
	namespaces: DIALECTE_NAMESPACES,
})

describe('assertXml', () => {
	it('passes for existing descendant chain', () => {
		const xmlDocument = parseXml(sampleXml)
		assertExpectedElementQueries({
			xmlDocument,
			queries: [
				'//default:A[@aA="valA"]//default:AAA_1[@aAAA_1="deep1"]//default:AAAA_1[@aAAAA_1="leaf1"]',
			],
		})
	})

	it('passes for direct child path', () => {
		const xmlDocument = parseXml(sampleXml)
		assertExpectedElementQueries({
			xmlDocument,
			queries: ['//default:Root[@root="1"]/default:A[@aA="valA"]/default:AA_1[@aAA_1="v1"]'],
		})
	})

	it('passes for ext namespace elements', () => {
		const xmlDocument = parseXml(sampleXml)
		assertExpectedElementQueries({
			xmlDocument,
			queries: ['//default:A[@aA="valA"]/ext:AA_3[@ext:aAA_3="v3"]'],
		})
	})

	it('passes for multiple independent queries', () => {
		const xmlDocument = parseXml(sampleXml)
		assertExpectedElementQueries({
			xmlDocument,
			queries: [
				'//default:A[@aA="valA"]',
				'//default:AAAA_1[@aAAAA_1="leaf1"]',
				'//default:B[@aB="valB"]',
			],
		})
	})

	it('fails with step-level diagnostics', () => {
		const xmlDocument = parseXml(sampleXml)
		expect(() =>
			assertExpectedElementQueries({
				xmlDocument,
				queries: ['//default:A[@aA="valA"]//default:AA_1[@aAA_1="NONEXISTENT"]//default:AAA_1'],
			}),
		).toThrow(/Failed at step 2\/3/)
	})

	it('fails at first step with root context', () => {
		const xmlDocument = parseXml(sampleXml)
		expect(() =>
			assertExpectedElementQueries({ xmlDocument, queries: ['//default:A[@aA="NOPE"]'] }),
		).toThrow(/No parent matched/)
	})

	it('shows last matched element in error', () => {
		const xmlDocument = parseXml(sampleXml)
		expect(() =>
			assertExpectedElementQueries({
				xmlDocument,
				queries: ['//default:A[@aA="valA"]//default:AA_1[@aAA_1="v1"]/default:NONEXISTENT'],
			}),
		).toThrow(/Last match at step 2\/3/)
	})

	it('handles positional predicate', () => {
		const xmlDocument = parseXml(sampleXml)
		assertExpectedElementQueries({
			xmlDocument,
			queries: ['//default:BB_1[@aBB_1="b1"]/default:BBB_1[2]'],
		})
	})
})

describe('assertXmlAbsent', () => {
	it('passes when element does not exist', () => {
		const xmlDocument = parseXml(sampleXml)
		assertUnexpectedElementQueries({ xmlDocument, queries: ['//default:A[@aA="NONEXISTENT"]'] })
	})

	it('passes for non-existing child relationship (ancestors exist)', () => {
		const xmlDocument = parseXml(sampleXml)
		// AA_1 is child of A, not of Root directly
		assertUnexpectedElementQueries({
			xmlDocument,
			queries: ['//default:Root[@root="1"]/default:AA_1[@aAA_1="v1"]'],
		})
	})

	it('fails when element does exist', () => {
		const xmlDocument = parseXml(sampleXml)
		expect(() =>
			assertUnexpectedElementQueries({ xmlDocument, queries: ['//default:A[@aA="valA"]'] }),
		).toThrow(/should NOT exist/)
	})

	it('works with following-sibling axis', () => {
		const xmlDocument = parseXml(sampleXml)
		// Only one A element, so no following-sibling A
		assertUnexpectedElementQueries({
			xmlDocument,
			queries: ['//default:A[@aA="valA"]/following-sibling::default:A'],
		})
	})

	it('fails when ancestor does not exist (unreliable assertion)', () => {
		const xmlDocument = parseXml(sampleXml)
		expect(() =>
			assertUnexpectedElementQueries({
				xmlDocument,
				queries: ['//default:A[@aA="NOPE"]//default:AA_1[@aAA_1="v1"]'],
			}),
		).toThrow(/ancestor step does not exist/)
	})

	it('passes with multi-step where ancestors exist but target absent', () => {
		const xmlDocument = parseXml(sampleXml)
		assertUnexpectedElementQueries({
			xmlDocument,
			queries: [
				'//default:A[@aA="valA"]//default:AA_1[@aAA_1="v1"]//default:AAA_1[@aAAA_1="NONEXISTENT"]',
			],
		})
	})
})
