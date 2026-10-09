import { resolveDefinition } from '@/utils'

import type {
	AssertValidXmlOptions,
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
 * attribute is a known attribute of its element. Elements unknown to the schema are
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

	function isForeignNamespaceElement(element: Element): boolean {
		return element.namespaceURI !== null && !knownNamespaceUris.includes(element.namespaceURI)
	}

	/**
	 * The namespace URIs the schema accepts for a `<child>` element under a parent. Local element names are
	 * reused across namespaces: a tag declared several ways lists, under its parent, the namespaces it is held
	 * in there; at the root only a global declaration applies. Where the parent holds it through a wildcard
	 * only, the wildcard decides: no namespace is expected. A tag declared one way has one. `undefined` when
	 * nothing is expected.
	 */
	function expectedNamespaceUris(
		parentDefinition: ResolvedDefinition | undefined,
		childLocalName: string,
	): string[] | undefined {
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
	function asRecord(element: Element, parentLocalName: string | undefined) {
		const attributes: AnyAttribute[] = Array.from(element.attributes).map((attribute) => ({
			name: attribute.name,
			value: attribute.value,
			...(attribute.namespaceURI
				? { namespace: { prefix: attribute.prefix ?? '', uri: attribute.namespaceURI } }
				: {}),
		}))
		const xsiType = element.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type')
		const colon = xsiType?.indexOf(':') ?? -1
		const prefix = xsiType && colon !== -1 ? xsiType.slice(0, colon) : null
		const bound = xsiType === null ? null : element.lookupNamespaceURI(prefix)
		if (bound !== null)
			attributes.push({ name: prefix ? `xmlns:${prefix}` : 'xmlns', value: bound })
		return {
			tagName: element.localName,
			parent: parentLocalName ? { id: '', tagName: parentLocalName } : null,
			namespace: { prefix: element.prefix ?? '', uri: element.namespaceURI ?? '' },
			attributes,
		}
	}

	function isAllowedChild(parentDefinition: ResolvedDefinition, childLocalName: string): boolean {
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

	function collectAttributeViolations(params: CollectAttributeViolationsParams): string[] {
		const { element, elementDefinition, requireComplete } = params

		const allowed = allowedAttributes(elementDefinition)
		// Skip namespaced attributes: xmlns/xsi, and any dev-namespaced test record id.
		// Only unprefixed schema attributes are validated.
		const unknownAttributeViolations = Array.from(element.attributes)
			.filter((attribute) => attribute.namespaceURI === null && !allowed.has(attribute.localName))
			.map(
				(attribute) =>
					`[attribute] <${element.localName}> has unknown attribute '${attribute.localName}'`,
			)
		if (!requireComplete) return unknownAttributeViolations

		const missingAttributeViolations = Object.entries(elementDefinition.attributes.details)
			.filter(([attributeName, rule]) => rule.required && !element.hasAttribute(attributeName))
			.map(
				([attributeName]) =>
					`[required] <${element.localName}> is missing required attribute '${attributeName}'`,
			)
		return [...unknownAttributeViolations, ...missingAttributeViolations]
	}

	function collectElementViolations(params: CollectElementViolationsParams): string[] {
		const { element, parent, requireComplete } = params
		const childElements = Array.from(element.children)

		// Opaque: not checked itself, and no parent context for its children — a schema
		// element nested inside is still validated on its own namespace and attributes.
		if (isForeignNamespaceElement(element)) {
			return childElements.flatMap((child) =>
				collectElementViolations({ element: child, parent: undefined, requireComplete }),
			)
		}

		const localName = element.localName
		const violations: string[] = []

		// 1. namespace (context-aware). "No namespace" has two encodings: the DOM reports it as
		// null, a schema with no target namespace declares ''. Normalize the element's side to ''
		// so a no-namespace element matches a no-namespace schema. (Foreignness above deliberately
		// stays on null: a no-namespace element is never foreign - it forgot its namespace.)
		const expectedNamespaces = expectedNamespaceUris(parent?.definition, localName)
		const actualNamespace = element.namespaceURI ?? ''
		if (expectedNamespaces !== undefined && !expectedNamespaces.includes(actualNamespace)) {
			const where = parent ? ` under <${parent.localName}>` : ''
			const declared = expectedNamespaces.map((uri) => uri || '(no namespace)').join(' or ')
			violations.push(
				`[namespace] <${element.tagName}>${where}: is in ${element.namespaceURI ?? '(no namespace)'}, schema declares ${declared}`,
			)
		}

		// 2. containment, by what the parent holds as it applies there
		if (parent?.definition && !isAllowedChild(parent.definition, localName)) {
			violations.push(`[containment] <${localName}> is not a valid child of <${parent.localName}>`)
		}

		// 3. attributes (known + required), only for schema-known elements: the declaration that applies,
		// and the type it names with xsi:type
		const elementDefinition = resolveDefinition({
			dialecteConfig,
			record: asRecord(element, parent?.localName),
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
			return `${label}: malformed XML — the XML declaration must be the very first characters of the string: remove the declaration (a snippet does not need one) or the whitespace before it`
		}

		const xmlDocument = new DOMParser().parseFromString(xml, 'application/xml')
		const parseError = xmlDocument.querySelector('parsererror')
		if (parseError) return `${label}: malformed XML — ${parseError.textContent?.trim()}`
		if (!xmlDocument.documentElement) return undefined

		const violations = collectElementViolations({
			element: xmlDocument.documentElement,
			parent: undefined,
			requireComplete,
		})
		return violations.length > 0
			? `${label}: not valid ${schemaName}:\n  ${violations.join('\n  ')}`
			: undefined
	}

	/**
	 * Assert a test XML string is valid, structurally. Throws with every violation when
	 * it is not.
	 */
	function assertValidXml(
		xml: string,
		label = 'test XML',
		options: AssertValidXmlOptions = {},
	): void {
		const requireComplete = options.requireComplete ?? true
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
