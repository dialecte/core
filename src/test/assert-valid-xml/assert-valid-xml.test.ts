import { DIALECTE_TEST_NAMESPACES, XMLNS_DEFAULT_NAMESPACE } from '../constant'
import { DEFINITION } from '../generated/definition.generated'
import { createXmlSchemaAssertions } from './assert-valid-xml'

import { describe, expect, it } from 'vitest'

const { assertValidXml, assertValidXmlTestCases } = createXmlSchemaAssertions({
	definition: DEFINITION,
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
						children: { sequence: ['Leaf'], details: { Leaf: {} } },
					},
					Leaf: {
						tag: 'Leaf',
						namespace: NO_NAMESPACE,
						parents: ['Plain'],
						attributes: { sequence: [], details: {} },
						children: { sequence: [], details: {} },
					},
				},
				namespaces: { default: NO_NAMESPACE },
				schemaName: 'Plain',
			})
			const xml = /* xml */ `<Plain name="p"><Leaf /></Plain>`

			expect(() => assertValidPlainXml(xml, 'snippet', { requireComplete: false })).not.toThrow()
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
