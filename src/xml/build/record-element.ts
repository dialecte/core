import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import {
	createXmlElement,
	getAttributeNS,
	hasAttribute,
	hasAttributeNS,
	lookupNamespaceURI,
	lookupPrefix,
	setAttribute,
	setAttributeNS,
} from './xml-element'

import { XMLNS_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { extractLocalName, resolveDefinition, resolveSchemaAttributeValue } from '@/utils'
import { storedNamespaceLookup, xsiTypeNameOf } from '@/utils/xsi-type'

import type { RecordElementContext } from './record-element.types'
import type { XmlElement } from './xml-element.types'
import type {
	AnyAttribute,
	AnyDialecteConfig,
	AnyQualifiedAttribute,
	AnyRawRecord,
	Namespace,
} from '@/types'

/**
 * The element a record is written as, with what the document holds on it: its attributes, the required and fixed
 * attributes the schema asks for and the record does not hold, its xsi:type prefix bound, the namespaces it needs
 * declared on the written root (where it is the root: the root attributes those namespaces bring), and its database
 * id when asked. Its text and children are the writer's.
 */
export function createRecordElement(params: {
	context: RecordElementContext
	record: AnyRawRecord
	parent: XmlElement | undefined
}): XmlElement {
	const { context, record, parent } = params
	return parent === undefined
		? createRootElement({ context, record })
		: createChildElement({ context, record, parent })
}

// ── Root ─────────────────────────────────────────────────────────────────────

function createRootElement(params: {
	context: RecordElementContext
	record: AnyRawRecord
}): XmlElement {
	const { context, record } = params
	const { config, declareNamespaces, withDatabaseIds } = context
	const element = createElementOf({ context, record, parent: undefined })
	context.rootElement = element
	if (declareNamespaces) {
		setAttribute({ element, qualifiedName: 'xmlns', value: record.namespace.uri })
	}
	addRecordAttributes({ context, element, attributes: record.attributes, isRoot: true })
	if (context.documentRoot) {
		enforceRootAttributes({
			config,
			element,
			namespace: record.namespace,
			rootRecord: context.documentRoot,
		})
	}
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) bindXsiTypePrefix({ context, element, record })
	return element
}

// ── Child ────────────────────────────────────────────────────────────────────

function createChildElement(params: {
	context: RecordElementContext
	record: AnyRawRecord
	parent: XmlElement
}): XmlElement {
	const { context, record, parent } = params
	const { config, declareNamespaces, withDatabaseIds } = context
	const isDefaultNamespace = record.namespace.uri === config.namespaces.default.uri
	const element = createElementOf({ context, record, parent })

	if (
		declareNamespaces &&
		!isDefaultNamespace &&
		record.namespace.prefix &&
		record.namespace.prefix !== 'xmlns'
	) {
		declareOnRoot({ context, namespace: record.namespace })
	}
	addRecordAttributes({ context, element, attributes: record.attributes, isRoot: false })
	if (declareNamespaces) materializeRequiredAndFixedAttributes({ context, element, record })
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) bindXsiTypePrefix({ context, element, record })
	return element
}

/**
 * The element named after its record: in the record's namespace, prefixed when that is not the dialecte's default
 * namespace. Without namespace declarations, the (possibly prefixed) name is written literally, in no namespace.
 */
function createElementOf(params: {
	context: RecordElementContext
	record: AnyRawRecord
	parent: XmlElement | undefined
}): XmlElement {
	const { context, record, parent } = params
	const isDefaultNamespace = record.namespace.uri === context.config.namespaces.default.uri
	const isPrefixed =
		!isDefaultNamespace && !!record.namespace.prefix && record.namespace.prefix !== 'xmlns'
	const qualifiedName = isPrefixed ? `${record.namespace.prefix}:${record.tagName}` : record.tagName
	return createXmlElement({
		namespaceURI: context.declareNamespaces ? record.namespace.uri : null,
		qualifiedName,
		parent,
	})
}

// ── Attributes ───────────────────────────────────────────────────────────────

/** The record's own attributes, in its order; namespace declarations are the writer's, not the record's. */
function addRecordAttributes(params: {
	context: RecordElementContext
	element: XmlElement
	attributes: AnyAttribute[]
	isRoot: boolean
}): void {
	const { context, element, attributes, isRoot } = params
	for (const attribute of attributes) {
		if (isNamespaceDeclaration(attribute)) continue
		const value = String(attribute.value)
		if (!isQualifiedAttribute(attribute) || !attribute.namespace.prefix) {
			setAttribute({ element, qualifiedName: attribute.name, value })
			continue
		}
		const qualifiedName = `${attribute.namespace.prefix}:${extractLocalName(attribute.name)}`
		// without namespace declarations the prefixed name is written literally
		if (!context.declareNamespaces) {
			setAttribute({ element, qualifiedName, value })
			continue
		}
		if (!isRoot) declareOnRoot({ context, namespace: attribute.namespace })
		setAttributeNS({ element, namespaceURI: attribute.namespace.uri, qualifiedName, value })
	}
}

/**
 * The `required` schema view (required and fixed attributes) the record does not hold, on a non-root element: an
 * export valid against the schema from a store that keeps what was written. Optional defaults are not added.
 */
function materializeRequiredAndFixedAttributes(params: {
	context: RecordElementContext
	element: XmlElement
	record: AnyRawRecord
}): void {
	const { context, element, record } = params
	const { config } = context
	// as declared under this parent: what a homonym requires differs from one parent to another
	const details = resolveDefinition({ dialecteConfig: config, record })?.attributes.details
	if (!details) return

	for (const [attributeName, attribute] of Object.entries(details)) {
		const value = resolveSchemaAttributeValue({
			dialecteConfig: config,
			record,
			attributeName,
			defaults: 'required',
		})
		if (value === undefined) continue

		const localName = extractLocalName(attributeName)
		const exists = attribute.namespace
			? hasAttributeNS({ element, namespaceURI: attribute.namespace.uri, localName })
			: hasAttribute({ element, qualifiedName: localName })
		if (exists) continue

		if (
			attribute.namespace &&
			attribute.namespace.prefix &&
			attribute.namespace.prefix !== 'xmlns'
		) {
			declareOnRoot({ context, namespace: attribute.namespace })
			setAttributeNS({
				element,
				namespaceURI: attribute.namespace.uri,
				qualifiedName: `${attribute.namespace.prefix}:${localName}`,
				value,
			})
		} else {
			setAttribute({ element, qualifiedName: localName, value })
		}
	}
}

// ── Root namespaces ──────────────────────────────────────────────────────────

/**
 * Declare a prefixed namespace on the written root the first time it is needed, and on the document root the root
 * attributes of that namespace the schema requires.
 */
function declareOnRoot(params: { context: RecordElementContext; namespace: Namespace }): void {
	const { context, namespace } = params
	const rootElement = context.rootElement
	if (!rootElement) return
	if (!namespace.prefix || namespace.prefix === 'xmlns') return
	const existing = getAttributeNS({
		element: rootElement,
		namespaceURI: XMLNS_NAMESPACE_URI,
		localName: namespace.prefix,
	})
	if (existing !== null) return
	setAttributeNS({
		element: rootElement,
		namespaceURI: XMLNS_NAMESPACE_URI,
		qualifiedName: `xmlns:${namespace.prefix}`,
		value: namespace.uri,
	})
	if (context.documentRoot) {
		enforceRootAttributes({
			config: context.config,
			element: rootElement,
			namespace,
			rootRecord: context.documentRoot,
		})
	}
}

/** The root attributes of a namespace the root's declaration requires or fixes, where the root does not hold them. */
function enforceRootAttributes(params: {
	config: AnyDialecteConfig
	element: XmlElement
	namespace: Namespace
	rootRecord: AnyRawRecord
}): void {
	const { config, element, namespace, rootRecord } = params
	// the root as declared: the global declaration of its namespace, and the type it names with xsi:type
	const details =
		resolveDefinition({ dialecteConfig: config, record: rootRecord })?.attributes.details ?? {}
	const isDefaultNamespace = namespace.uri === config.namespaces.default.uri

	for (const [attributeName, attribute] of Object.entries(details)) {
		const value = resolveSchemaAttributeValue({
			dialecteConfig: config,
			record: rootRecord,
			attributeName,
			defaults: 'required',
		})
		if (value === undefined) continue
		const inNamespace = isDefaultNamespace
			? !attribute.namespace
			: attribute.namespace?.prefix === namespace.prefix &&
				attribute.namespace?.uri === namespace.uri
		if (!inNamespace) continue

		const localName = extractLocalName(attributeName)
		const exists = attribute.namespace
			? hasAttributeNS({ element, namespaceURI: attribute.namespace.uri, localName })
			: hasAttribute({ element, qualifiedName: localName })
		if (exists) continue

		if (attribute.namespace) {
			setAttributeNS({
				element,
				namespaceURI: attribute.namespace.uri,
				qualifiedName: `${attribute.namespace.prefix}:${localName}`,
				value,
			})
		} else {
			setAttribute({ element, qualifiedName: localName, value })
		}
	}
}

// ── xsi:type ─────────────────────────────────────────────────────────────────

/**
 * Bind the prefix of the element's xsi:type value where the element stands: a name is bound by the serializer, a
 * value is not. A dialecte prefix is declared on the root like an attribute's; when the binding in scope at the
 * element still names another namespace (an element in a foreign namespace re-binding it, or the default
 * namespace), the value takes a prefix bound to its namespace there, declared on the element when none is. A value
 * core cannot read is written as stored.
 */
function bindXsiTypePrefix(params: {
	context: RecordElementContext
	element: XmlElement
	record: AnyRawRecord
}): void {
	const { context, element, record } = params
	const { config } = context
	const value = getAttributeNS({ element, namespaceURI: XSI_NAMESPACE.uri, localName: 'type' })
	if (value === null) return
	const name = xsiTypeNameOf({
		value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig: config, attributes: record.attributes }),
	})
	if (name === undefined || name.namespace === '') return

	const colon = value.indexOf(':')
	const prefix = colon === -1 ? '' : value.slice(0, colon)
	const isDialectePrefix = Object.values(config.namespaces).some(
		(namespace) => namespace.prefix === prefix && namespace.uri === name.namespace,
	)
	if (prefix && isDialectePrefix) {
		declareOnRoot({ context, namespace: { prefix, uri: name.namespace } })
	}
	if (lookupNamespaceURI({ element, prefix: prefix || null }) === name.namespace) return

	// a prefix an ancestor binds to the namespace, unless a closer element re-binds it (DOM lookupPrefix does not check)
	const found = lookupPrefix({ element, namespaceURI: name.namespace })
	const bound =
		found !== null && lookupNamespaceURI({ element, prefix: found }) === name.namespace
			? found
			: null
	const written = bound ?? freePrefix({ element })
	if (bound === null) {
		setAttributeNS({
			element,
			namespaceURI: XMLNS_NAMESPACE_URI,
			qualifiedName: `xmlns:${written}`,
			value: name.namespace,
		})
	}
	const xsiPrefix = lookupPrefix({ element, namespaceURI: XSI_NAMESPACE.uri }) ?? 'xsi'
	setAttributeNS({
		element,
		namespaceURI: XSI_NAMESPACE.uri,
		qualifiedName: `${xsiPrefix}:type`,
		value: `${written}:${name.local}`,
	})
}

/** A prefix bound to nothing where the element stands: `ns1`, `ns2`, … */
function freePrefix(params: { element: XmlElement }): string {
	const { element } = params
	for (let index = 1; ; index++) {
		const prefix = `ns${index}`
		if (lookupNamespaceURI({ element, prefix }) === null) return prefix
	}
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isQualifiedAttribute(attribute: AnyAttribute): attribute is AnyQualifiedAttribute {
	return !!attribute.namespace
}

function isNamespaceDeclaration(attribute: AnyAttribute): boolean {
	if (attribute.name === 'xmlns') return true
	if (attribute.name.startsWith('xmlns:')) return true
	return attribute.namespace?.prefix === 'xmlns'
}
