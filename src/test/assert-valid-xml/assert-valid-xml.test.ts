import { DIALECTE_TEST_NAMESPACES, XMLNS_DEFAULT_NAMESPACE } from '../constant'
import { DEFINITION, TYPES } from '../generated/definition.generated'
import { createXmlSchemaAssertions } from './assert-valid-xml'

import { describe, expect, it } from 'vitest'

const { assertValidXml, assertValidXmlTestCases } = createXmlSchemaAssertions({
	definition: DEFINITION,
	types: TYPES,
	namespaces: DIALECTE_TEST_NAMESPACES,
	schemaName: 'TestDialecte',
})

const VENDOR_URI = 'http://vendor.example/private-elements'
const XMLNS_VENDOR_NAMESPACE = `xmlns:vendor="${VENDOR_URI}"`

function captureErrorMessage(run: () => void): string {
	try {
		run()
	} catch (error) {
		return (error as Error).message
	}
	return ''
}

describe('createXmlSchemaAssertions › assertValidXml', () => {
	describe('accepts', () => {
		it('a structurally valid snippet', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} root="1">
					<A aA="VALID">
						<AA_1 aAA_1="v1" />
					</A>
				</Root>
			`
			expect(() => assertValidXml(xml, 'snippet', { requireComplete: false })).not.toThrow()
		})

		it('a foreign-namespace element whose local name collides with a schema element', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_VENDOR_NAMESPACE} root="1">
					<A aA="VALID">
						<vendor:AA_1 vendor:anything="1" />
					</A>
				</Root>
			`
			expect(() => assertValidXml(xml, 'snippet', { requireComplete: false })).not.toThrow()
		})
		it('a document in no namespace, for a schema that declares none', () => {
			const NO_NAMESPACE = { prefix: '', uri: '' }
			const { assertValidXml: assertValidPlainXml } = createXmlSchemaAssertions({
				definition: {
					Plain: {
						tag: 'Plain',
						namespace: NO_NAMESPACE,
						parents: [],
						attributes: { sequence: ['name'], details: { name: {} } },
						children: { sequence: ['Leaf'], details: {} },
					},
					Leaf: {
						tag: 'Leaf',
						namespace: NO_NAMESPACE,
						parents: ['Plain'],
						attributes: { sequence: [], details: {} },
						children: { sequence: [], details: {} },
					},
				},
				types: {},
				namespaces: { default: NO_NAMESPACE },
				schemaName: 'Plain',
			})
			const xml = /* xml */ `<Plain name="p"><Leaf /></Plain>`

			expect(() => assertValidPlainXml(xml, 'snippet', { requireComplete: false })).not.toThrow()
		})
	})

	describe('a tag declared in two namespaces', () => {
		const NO_NAMESPACE = { prefix: '', uri: '' }
		const leafIn = (uri: string) => ({
			namespace: { prefix: uri ? 'b' : '', uri },
			attributes: { sequence: [], details: {} },
			children: { sequence: [], details: {} },
		})
		const { assertValidXml: assertValidTwoNamespaces } = createXmlSchemaAssertions({
			definition: {
				Plain: {
					tag: 'Plain',
					namespace: NO_NAMESPACE,
					parents: [],
					attributes: { sequence: [], details: {} },
					// Plain holds the second way only
					children: { sequence: ['Leaf'], details: { Leaf: { declarations: { 'urn:b': ['2'] } } } },
				},
				Leaf: {
					...leafIn(''),
					tag: 'Leaf',
					parents: ['Plain'],
					// the first one global: the only one a document may start with
					declarations: { '1': { ...leafIn(''), global: true }, '2': leafIn('urn:b') },
				},
			},
			types: {},
			namespaces: { default: NO_NAMESPACE, b: { prefix: 'b', uri: 'urn:b' } },
			schemaName: 'Plain',
		})

		it('accepts it in the namespace its parent holds it in', () => {
			const xml = /* xml */ `<Plain xmlns:b="urn:b"><b:Leaf /></Plain>`
			expect(() =>
				assertValidTwoNamespaces(xml, 'snippet', { requireComplete: false }),
			).not.toThrow()
		})

		it('accepts it at the root in the namespace of its global declaration only', () => {
			expect(() =>
				assertValidTwoNamespaces('<Leaf />', 'snippet', { requireComplete: false }),
			).not.toThrow()
			const message = captureErrorMessage(() =>
				assertValidTwoNamespaces('<b:Leaf xmlns:b="urn:b" />', 'snippet', {
					requireComplete: false,
				}),
			)
			expect(message).toContain('[namespace] <b:Leaf>: is in urn:b')
		})

		it('accepts it in any namespace where a wildcard alone holds it', () => {
			const { assertValidXml: assertValidUnderWildcard } = createXmlSchemaAssertions({
				definition: {
					Open: {
						tag: 'Open',
						namespace: NO_NAMESPACE,
						parents: [],
						attributes: { sequence: [], details: {} },
						children: { sequence: [], any: true, details: {} },
					},
					Leaf: {
						...leafIn(''),
						tag: 'Leaf',
						parents: [],
						declarations: { '1': { ...leafIn(''), global: true }, '2': leafIn('urn:b') },
					},
				},
				types: {},
				namespaces: { default: NO_NAMESPACE, b: { prefix: 'b', uri: 'urn:b' } },
				schemaName: 'Open',
			})
			const xml = /* xml */ `<Open xmlns:b="urn:b"><b:Leaf /></Open>`
			expect(() =>
				assertValidUnderWildcard(xml, 'snippet', { requireComplete: false }),
			).not.toThrow()
		})

		it('rejects it in the namespace of a way its parent does not hold', () => {
			const xml = /* xml */ `<Plain><Leaf /></Plain>`
			const message = captureErrorMessage(() =>
				assertValidTwoNamespaces(xml, 'snippet', { requireComplete: false }),
			)
			expect(message).toContain('[namespace] <Leaf> under <Plain>')
		})
	})

	describe("a parent's own declaration", () => {
		const NO_NAMESPACE = { prefix: '', uri: '' }
		const H = { prefix: 'h', uri: 'urn:h' }
		const empty = {
			attributes: { sequence: [], details: {} },
			children: { sequence: [], details: {} },
		}
		const leaf = (required: string) => ({
			...empty,
			namespace: NO_NAMESPACE,
			attributes: { sequence: [required], details: { [required]: { required: true as const } } },
		})
		const holds = (id: string) => ({
			sequence: ['Leaf'],
			details: { Leaf: { declarations: { '': [id] } } },
		})
		const { assertValidXml: assertValidByParent } = createXmlSchemaAssertions({
			definition: {
				// Holder declared in two namespaces: the global one in no namespace holds Leaf 1, which requires x
				Holder: {
					...empty,
					tag: 'Holder',
					namespace: NO_NAMESPACE,
					parents: [],
					children: { sequence: ['Leaf'], details: { Leaf: { declarations: { '': ['1', '2'] } } } },
					declarations: {
						'1': { ...empty, namespace: NO_NAMESPACE, global: true, children: holds('1') },
						'2': { ...empty, namespace: H, global: true, children: holds('2') },
					},
				},
				Leaf: {
					...empty,
					tag: 'Leaf',
					namespace: NO_NAMESPACE,
					parents: ['Holder'],
					declarations: { '1': leaf('x'), '2': leaf('y') },
				},
			},
			types: {},
			namespaces: { default: NO_NAMESPACE, h: H },
			schemaName: 'Holder',
		})

		it('decides what its child requires', () => {
			const message = captureErrorMessage(() =>
				assertValidByParent('<Holder><Leaf y="1" /></Holder>', 'snippet'),
			)
			expect(message).toContain("[required] <Leaf> is missing required attribute 'x'")
		})
	})

	describe('xsi:type', () => {
		const NO_NAMESPACE = { prefix: '', uri: '' }
		const empty = {
			attributes: { sequence: [], details: {} },
			children: { sequence: [], details: {} },
		}
		const { assertValidXml: assertValidTyped } = createXmlSchemaAssertions({
			definition: {
				Outer: {
					...empty,
					tag: 'Outer',
					namespace: NO_NAMESPACE,
					parents: [],
					children: { sequence: ['Plain'], details: {} },
				},
				// Plain admits tWide, which adds a required `wide`
				Plain: {
					...empty,
					tag: 'Plain',
					namespace: NO_NAMESPACE,
					parents: ['Outer'],
					variants: ['{urn:t}tWide'],
				},
			},
			types: {
				'{urn:t}tWide': {
					...empty,
					attributes: { sequence: ['wide'], details: { wide: { required: true } } },
				},
			},
			namespaces: { default: NO_NAMESPACE },
			schemaName: 'Plain',
		})
		const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'

		it('accepts the attributes of the type an element names, its prefix bound on an ancestor', () => {
			const xml = /* xml */ `<Outer xmlns:t="urn:t" ${XSI}><Plain xsi:type="t:tWide" wide="1" /></Outer>`
			expect(() => assertValidTyped(xml, 'snippet')).not.toThrow()
		})

		it('requires what the type requires', () => {
			const xml = /* xml */ `<Outer xmlns:t="urn:t" ${XSI}><Plain xsi:type="t:tWide" /></Outer>`
			const message = captureErrorMessage(() => assertValidTyped(xml, 'snippet'))
			expect(message).toContain("[required] <Plain> is missing required attribute 'wide'")
		})

		it('rejects the attributes of a type the element does not name', () => {
			const xml = /* xml */ `<Outer><Plain wide="1" /></Outer>`
			const message = captureErrorMessage(() => assertValidTyped(xml, 'snippet'))
			expect(message).toContain("[attribute] <Plain> has unknown attribute 'wide'")
		})
	})

	describe('rejects', () => {
		it('schema elements left in no namespace', () => {
			const xml = /* xml */ `
				<Root>
					<A aA="VALID" />
				</Root>
			`
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: false }),
			)
			expect(message).toContain('not valid TestDialecte')
			expect(message).toContain('[namespace] <Root>')
			expect(message).toContain('[namespace] <A> under <Root>')
		})

		it('a schema element nested in a foreign-namespace element but left in the wrong namespace', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_VENDOR_NAMESPACE} root="1">
					<A aA="VALID">
						<vendor:Wrapper>
							<AA_3 />
						</vendor:Wrapper>
					</A>
				</Root>
			`
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: false }),
			)
			// AA_3's schema namespace is the ext namespace; here it inherits the default one.
			expect(message).toContain('[namespace] <AA_3>')
		})

		it('a child the schema does not allow under its parent', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} root="1">
					<A aA="VALID">
						<AAAA_1 aAAAA_1="leaf" />
					</A>
				</Root>
			`
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: false }),
			)
			expect(message).toContain('[containment] <AAAA_1> is not a valid child of <A>')
		})

		it('an attribute the schema does not declare', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} root="1">
					<A aA="VALID" notASchemaAttribute="x" />
				</Root>
			`
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: false }),
			)
			expect(message).toContain("[attribute] <A> has unknown attribute 'notASchemaAttribute'")
		})

		it('a missing required attribute, only when requireComplete is on', () => {
			const xml = /* xml */ `
				<Root ${XMLNS_DEFAULT_NAMESPACE} root="1">
					<A>
						<AA_1 aAA_1="v1" />
					</A>
				</Root>
			`
			// aA is required on <A>; omitted here.
			expect(() => assertValidXml(xml, 'snippet', { requireComplete: false })).not.toThrow()
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: true }),
			)
			expect(message).toContain("[required] <A> is missing required attribute 'aA'")
		})

		it('an XML declaration preceded by whitespace, saying how to fix it', () => {
			const xml = /* xml */ `
				<?xml version="1.0" encoding="UTF-8"?>
				<Root ${XMLNS_DEFAULT_NAMESPACE} root="1" />
			`
			const message = captureErrorMessage(() =>
				assertValidXml(xml, 'snippet', { requireComplete: false }),
			)
			expect(message).toContain('snippet: malformed XML')
			expect(message).toContain('must be the very first characters')
		})
	})
})

describe('createXmlSchemaAssertions › assertValidXmlTestCases', () => {
	it('passes when every case is valid', () => {
		const testCases = {
			'passing case': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} root="1" />`,
			},
		}
		expect(() => assertValidXmlTestCases({ testCases })).not.toThrow()
	})

	it('reports the violations of every invalid case at once, attributed to the case name', () => {
		const testCases = {
			'passing case': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} root="1" />`,
			},
			'first invalid case': {
				sourceXml: /* xml */ `
					<Root>
						<A aA="VALID" />
					</Root>
				`,
			},
			'second invalid case': {
				sourceXml: /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE} root="1" />`,
				targetXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} root="1">
						<A aA="VALID" notASchemaAttribute="x" />
					</Root>
				`,
			},
		}
		const message = captureErrorMessage(() => assertValidXmlTestCases({ testCases }))
		expect(message).toContain('first invalid case › sourceXml')
		expect(message).toContain('second invalid case › targetXml')
		expect(message).toContain("unknown attribute 'notASchemaAttribute'")
		expect(message).not.toContain('passing case')
	})
})
