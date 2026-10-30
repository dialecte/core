import { MalformedXmlError, XmlElement, withXmlDocument } from '../xml'
import {
	ALWAYS_ALLOWED_NAMESPACE_URIS,
	XSI_TYPE_ATTRIBUTE_NAME,
} from './assert-valid-xml.constants'

import { XSI_NAMESPACE } from '@/helpers/constant'
import { isNamespaceAllowedByWildcard, resolveDefinition } from '@/utils'

import type { XmlAttribute } from '../xml'
import type {
	AssertValidXmlParams,
	AssertValidXmlTestCasesParams,
	CollectAttributeViolationsParams,
	CollectElementViolationsParams,
	CreateXmlSchemaAssertionsParams,
	DescribeInvalidXmlParams,
} from './assert-valid-xml.types'
import type { AnyAttribute, ResolvedDefinition } from '@/types'

/**
 * Create structural XML assertions bound to a dialecte's generated `definition`
 * and declared `namespaces`. Instantiate once per dialecte (e.g. in scl test) and
 * re-export alongside createTestProject, like createXmlAssertions.
 *
 * `assertValidXml` asserts, structurally: every element's namespace matches its
 * parent context, every element is an allowed child of its parent, and every
 * attribute is a known attribute of its element - in whatever namespace: declared by the element (a dialecte
 * namespace under any prefix the document binds), or allowed by its attribute wildcard. Namespace declarations,
 * `xsi:*` and the test record id are always allowed. Elements unknown to the schema are
 * skipped (bespoke content under a transparent `Private`), and so is any element in
 * a namespace the dialecte does not declare — even when its local name collides with
 * a schema element. An element in NO namespace is not foreign — it is a schema
 * element the snippet forgot to put in its namespace, and stays validated.
 *
 * `requireComplete` (default `true`) additionally requires every schema-required
 * attribute to be present. NOT yet enforced (planned with the validation feature):
 * attribute VALUE facets (uuid pattern, enums, datatypes) and cross-element
 * constraints (unique keys, keyref resolution).
 */
export function createXmlSchemaAssertions(params: CreateXmlSchemaAssertionsParams) {
	const { definition, types, namespaces, schemaName = 'XML' } = params
	const dialecteConfig = {
		definition,
		types,
		namespaces,
	}
	const knownNamespaceUris: readonly string[] = Object.values(namespaces).map(
		(namespace) => namespace.uri,
	)

	function isForeignNamespaceElement(element: XmlElement): boolean {
		return element.namespaceUri !== '' && !knownNamespaceUris.includes(element.namespaceUri)
	}

	/**
	 * The namespace URIs the schema accepts for a `<child>` element under a parent. Local element names are
	 * reused across namespaces: a tag declared several ways lists, under its parent, the namespaces it is held
	 * in there; at the root only a global declaration applies. Where the parent holds it through a wildcard
	 * only, the wildcard decides: no namespace is expected. A tag declared one way has one. `undefined` when
	 * nothing is expected.
	 */
	function expectedNamespaceUris(params: {
		parentDefinition: ResolvedDefinition | undefined
		childLocalName: string
	}): string[] | undefined {
		const { parentDefinition, childLocalName } = params
		const child = definition[childLocalName]
		if (child === undefined) return undefined
		const held = parentDefinition?.children.details[childLocalName]?.declarations
		if (held !== undefined) return Object.keys(held)
		const heldByWildcardOnly =
			parentDefinition?.children.any === true &&
			!parentDefinition.children.sequence.includes(childLocalName)
		if (heldByWildcardOnly) return undefined
		const declarations = Object.values(child.declarations ?? {})
		const globals = parentDefinition
			? declarations
			: declarations.filter((declaration) => declaration.global)
		return globals.length > 0
			? [...new Set(globals.map((declaration) => declaration.namespace.uri))]
			: [child.namespace.uri]
	}

	/** The element as a record resolving reads it: its attributes, the xsi:type prefix bound where it is in scope. */
	function asRecord(params: { element: XmlElement; parentLocalName: string | undefined }) {
		const { element, parentLocalName } = params
		const attributes: AnyAttribute[] = element.attrs.map((attribute) => ({
			name: qualifiedNameOf(attribute),
			value: attribute.value,
			...(attribute.namespaceUri
				? { namespace: { prefix: attribute.prefix, uri: attribute.namespaceUri } }
				: {}),
		}))
		const xsiType = element.attrs.find(
			(attribute) =>
				attribute.namespaceUri === XSI_NAMESPACE.uri && attribute.name === XSI_TYPE_ATTRIBUTE_NAME,
		)?.value
		const colon = xsiType?.indexOf(':') ?? -1
		const prefix = xsiType !== undefined && colon !== -1 ? xsiType.slice(0, colon) : ''
		const bound = xsiType === undefined ? null : element.namespaceForPrefix(prefix)
		if (bound !== null)
			attributes.push({ name: prefix ? `xmlns:${prefix}` : 'xmlns', value: bound })
		return {
			tagName: element.name,
			parent: parentLocalName ? { id: '', tagName: parentLocalName } : null,
			namespace: { prefix: element.prefix, uri: element.namespaceUri },
			attributes,
		}
	}

	function isAllowedChild(params: {
		parentDefinition: ResolvedDefinition
		childLocalName: string
	}): boolean {
		const { parentDefinition, childLocalName } = params
		const children = parentDefinition.children
		if (children.any === true) return true
		if (children.sequence.includes(childLocalName)) return true
		return childLocalName in children.details
	}

	/** Attribute names the element may carry, per the schema (sequence ∪ detail keys). */
	function allowedAttributes(elementDefinition: ResolvedDefinition): Set<string> {
		return new Set([
			...elementDefinition.attributes.sequence,
			...Object.keys(elementDefinition.attributes.details),
		])
	}

	/**
	 * Whether the element carries a definition attribute: `prefix:local` is the dialecte's prefix, which a document may
	 * bind to its namespace under another - the attribute is looked up by namespace and local name.
	 */
	function hasSchemaAttribute(params: { element: XmlElement; attributeName: string }): boolean {
		const { element, attributeName } = params
		const colon = attributeName.indexOf(':')
		if (colon === -1) return hasAttribute({ element, namespaceUri: '', localName: attributeName })
		const prefix = attributeName.slice(0, colon)
		const namespace = Object.values(namespaces).find((candidate) => candidate.prefix === prefix)
		if (namespace === undefined)
			return element.attrs.some((attribute) => qualifiedNameOf(attribute) === attributeName)
		return hasAttribute({
			element,
			namespaceUri: namespace.uri,
			localName: attributeName.slice(colon + 1),
		})
	}

	/**
	 * The name the definition keys an attribute by: bare in no namespace or the default one, `prefix:local` under the
	 * dialecte's prefix for another namespace it declares (whatever prefix the document bound), as written otherwise.
	 */
	function storedAttributeName(attribute: XmlAttribute): string {
		if (attribute.namespaceUri === '') return attribute.name
		const namespace = Object.values(namespaces).find(
			(candidate) => candidate.uri === attribute.namespaceUri,
		)
		if (namespace === undefined) return qualifiedNameOf(attribute)
		return namespace.prefix ? `${namespace.prefix}:${attribute.name}` : attribute.name
	}

	function collectAttributeViolations(params: CollectAttributeViolationsParams): string[] {
		const { element, elementDefinition, requireComplete } = params

		const allowed = allowedAttributes(elementDefinition)
		const unknownAttributeViolations = element.attrs
			.filter((attribute) => !ALWAYS_ALLOWED_NAMESPACE_URIS.includes(attribute.namespaceUri))
			.filter(
				(attribute) =>
					!allowed.has(storedAttributeName(attribute)) &&
					!isNamespaceAllowedByWildcard({
						wildcard: elementDefinition.attributes.any,
						namespaceUri: attribute.namespaceUri,
					}),
			)
			.map(
				(attribute) =>
					`[attribute] <${element.name}> has unknown attribute '${storedAttributeName(attribute)}'`,
			)
		if (!requireComplete) return unknownAttributeViolations

		const missingAttributeViolations = Object.entries(elementDefinition.attributes.details)
			.filter(
				([attributeName, rule]) => rule.required && !hasSchemaAttribute({ element, attributeName }),
			)
			.map(
				([attributeName]) =>
					`[required] <${element.name}> is missing required attribute '${attributeName}'`,
			)
		return [...unknownAttributeViolations, ...missingAttributeViolations]
	}

	function collectElementViolations(params: CollectElementViolationsParams): string[] {
		const { element, parent, requireComplete } = params
		const childElements = childElementsOf(element)

		// Opaque: not checked itself, and no parent context for its children — a schema
		// element nested inside is still validated on its own namespace and attributes.
		if (isForeignNamespaceElement(element)) {
			return childElements.flatMap((child) =>
				collectElementViolations({ element: child, parent: undefined, requireComplete }),
			)
		}

		const localName = element.name
		const violations: string[] = []

		// 1. namespace (context-aware). No namespace is '' on both sides: the engine's and a schema with no
		// target namespace. (A no-namespace element is never foreign above: it forgot its namespace.)
		const expectedNamespaces = expectedNamespaceUris({
			parentDefinition: parent?.definition,
			childLocalName: localName,
		})
		const actualNamespace = element.namespaceUri
		if (expectedNamespaces !== undefined && !expectedNamespaces.includes(actualNamespace)) {
			const where = parent ? ` under <${parent.localName}>` : ''
			const declared = expectedNamespaces.map((uri) => uri || '(no namespace)').join(' or ')
			violations.push(
				`[namespace] <${qualifiedNameOf(element)}>${where}: is in ${actualNamespace || '(no namespace)'}, schema declares ${declared}`,
			)
		}

		// 2. containment, by what the parent holds as it applies there
		if (
			parent?.definition &&
			!isAllowedChild({ parentDefinition: parent.definition, childLocalName: localName })
		) {
			violations.push(`[containment] <${localName}> is not a valid child of <${parent.localName}>`)
		}

		// 3. attributes (known + required), only for schema-known elements: the declaration that applies,
		// and the type it names with xsi:type
		const elementDefinition = resolveDefinition({
			dialecteConfig,
			record: asRecord({ element, parentLocalName: parent?.localName }),
			parentDefinition: parent?.definition,
		})
		const attributeViolations = elementDefinition
			? collectAttributeViolations({ element, elementDefinition, requireComplete })
			: []

		const childViolations = childElements.flatMap((child) =>
			collectElementViolations({
				element: child,
				parent: { localName, definition: elementDefinition },
				requireComplete,
			}),
		)
		return [...violations, ...attributeViolations, ...childViolations]
	}

	/** The reason `xml` is not valid — `undefined` when it is valid. */
	function describeInvalidXml(params: DescribeInvalidXmlParams): string | undefined {
		const { xml, label, requireComplete } = params

		// A template-literal snippet usually starts with a newline; an XML declaration after
		// it is malformed for every XML parser, with a message that does not say why. Say it.
		if (!xml.startsWith('<?xml') && xml.trimStart().startsWith('<?xml')) {
			return `${label}: malformed XML - the XML declaration must be the very first characters of the string: remove the declaration (a snippet does not need one) or the whitespace before it`
		}

		try {
			const violations = withXmlDocument({ xml, label }, function collectViolations(document) {
				return collectElementViolations({
					element: document.root,
					parent: undefined,
					requireComplete,
				})
			})
			return violations.length > 0
				? `${label}: not valid ${schemaName}:\n  ${violations.join('\n  ')}`
				: undefined
		} catch (error) {
			if (error instanceof MalformedXmlError) return error.message
			throw error
		}
	}

	/**
	 * Assert a test XML string is valid, structurally. Throws with every violation when
	 * it is not.
	 */
	function assertValidXml(params: AssertValidXmlParams): void {
		const { xml, label = 'test XML', requireComplete = true } = params
		const invalidReason = describeInvalidXml({ xml, label, requireComplete })
		if (invalidReason) throw new Error(invalidReason)
	}

	/**
	 * Validate every case's `sourceXml`/`targetXml` and throw ONCE with the violations of
	 * all invalid cases, each attributed to its case name — so a suite's fixtures are fixed
	 * in one round instead of one failure at a time.
	 */
	function assertValidXmlTestCases(params: AssertValidXmlTestCasesParams): void {
		const { testCases } = params
		const invalidReasons = Object.entries(testCases).flatMap(([name, testCase]) => {
			const sourceReason = describeInvalidXml({
				xml: testCase.sourceXml,
				label: `${name} › sourceXml`,
				requireComplete: false,
			})
			const targetReason = testCase.targetXml
				? describeInvalidXml({
						xml: testCase.targetXml,
						label: `${name} › targetXml`,
						requireComplete: false,
					})
				: undefined
			return [sourceReason, targetReason].filter((reason) => reason !== undefined)
		})
		if (invalidReasons.length > 0) throw new Error(invalidReasons.join('\n'))
	}

	return { assertValidXml, assertValidXmlTestCases }
}

/** The name as the document writes it: `prefix:name`, or `name` without a prefix. */
function qualifiedNameOf(node: XmlElement | XmlAttribute): string {
	return node.prefix ? `${node.prefix}:${node.name}` : node.name
}

/** The element children of an element, in document order. */
function childElementsOf(element: XmlElement): XmlElement[] {
	const children: XmlElement[] = []
	for (let child = element.firstChild; child; child = child.next) {
		if (child instanceof XmlElement) children.push(child)
	}
	return children
}

function hasAttribute(params: {
	element: XmlElement
	namespaceUri: string
	localName: string
}): boolean {
	const { element, namespaceUri, localName } = params
	return element.attrs.some(
		(attribute) => attribute.name === localName && attribute.namespaceUri === namespaceUri,
	)
}
