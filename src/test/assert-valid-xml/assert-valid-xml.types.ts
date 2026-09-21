import type { AnyDefinition, ElementDefinition, Namespace } from '@/types'

/** Options controlling how strict a single-document validation is. */
export type AssertValidXmlOptions = {
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
	/** The dialecte's declared namespaces; their URIs form the "known" set. */
	namespaces: Record<string, Namespace>
	/** Names the schema in violation messages ("not valid SCL"). Default `'XML'`. */
	schemaName?: string
}

export type CollectElementViolationsParams = {
	element: Element
	parentLocalName: string | undefined
	requireComplete: boolean
}

export type CollectAttributeViolationsParams = {
	element: Element
	elementDefinition: ElementDefinition
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
