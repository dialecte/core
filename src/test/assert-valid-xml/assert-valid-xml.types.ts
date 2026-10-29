import type { XmlDomElement } from '../xml-dom'
import type { AnyDefinition, AnyDialecteConfig, AnyTypes, ResolvedDefinition } from '@/types'

/** One XML string to validate, how it is named in the messages and how strict the validation is. */
export type AssertValidXmlParams = {
	xml: string
	/** Names the XML in the messages. Default `'test XML'`. */
	label?: string
	/**
	 * Also require every schema-required attribute to be present. Default `true`;
	 * minimal fixtures legitimately omit required attributes (a bare `<SCL>` without
	 * `version`/`revision`/`release`) and pass `false`.
	 */
	requireComplete?: boolean
}

export type CreateXmlSchemaAssertionsParams = {
	/** The dialecte's generated element definitions, keyed by local name. */
	definition: AnyDefinition
	/** The types its elements may take with xsi:type: the `TYPES` generated beside the definition. */
	types: AnyTypes
	/** The dialecte's declared namespaces; their URIs form the "known" set. */
	namespaces: AnyDialecteConfig['namespaces']
	/** Names the schema in violation messages ("not valid SCL"). Default `'XML'`. */
	schemaName?: string
}

export type CollectElementViolationsParams = {
	element: XmlDomElement
	/** The parent element's definition as it applies there; `undefined` at the root or under a foreign element. */
	parent: { localName: string; definition: ResolvedDefinition | undefined } | undefined
	requireComplete: boolean
}

export type CollectAttributeViolationsParams = {
	element: XmlDomElement
	elementDefinition: ResolvedDefinition
	requireComplete: boolean
}

export type DescribeInvalidXmlParams = {
	xml: string
	label: string
	requireComplete: boolean
}

export type XmlSchemaTestCase = { sourceXml: string; targetXml?: string }

export type AssertValidXmlTestCasesParams = {
	testCases: Record<string, XmlSchemaTestCase>
}
