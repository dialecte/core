import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import {
	createXmlElement,
	getAttributeNS,
	hasAttribute,
	hasAttributeNS,
	lookupNamespaceURI,
	setAttribute,
	setAttributeNS,
} from './xml-element'

import { XSI_NAMESPACE } from '@/helpers/constant'
import { extractLocalName, resolveDefinition, resolveSchemaAttributeValue } from '@/utils'
import { storedNamespaceLookup, xsiTypeNameOf } from '@/utils/xsi-type'

import type { RecordElementContext } from './record-element.types'
import type { XmlElement } from './xml-element.types'
import type { AnyAttribute, AnyQualifiedAttribute, AnyRawRecord, Namespace } from '@/types'

/**
 * The element a record is written as, with what the document holds on it: its attributes, the required and fixed
 * attributes the schema asks for and the record does not hold, its xsi:type value written with the prefix its
 * namespace takes, every namespace it uses registered for the written root (where it is the root: the root attributes
 * those namespaces bring), and its database id when asked. Its text and children are the writer's.
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
	const { declareNamespaces, withDatabaseIds } = context
	context.namespaces.openRoot({ uri: record.namespace.uri })
	const element = createElementOf({ context, record, parent: undefined })
	addRecordAttributes({ context, element, attributes: record.attributes })
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) writeXsiType({ context, element })
	// the root attributes of the namespaces the root itself uses, once it holds its own: later namespaces bring theirs
	// as they are registered
	context.namespaces.attachRoot({ element })
	return element
}

// ── Child ────────────────────────────────────────────────────────────────────

function createChildElement(params: {
	context: RecordElementContext
	record: AnyRawRecord
	parent: XmlElement
}): XmlElement {
	const { context, record, parent } = params
	const { declareNamespaces, withDatabaseIds } = context
	const element = createElementOf({ context, record, parent })
	addRecordAttributes({ context, element, attributes: record.attributes })
	if (declareNamespaces) materializeRequiredAndFixedAttributes({ context, element, record })
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) writeXsiType({ context, element })
	return element
}

/**
 * The element named after its record, with the prefix its namespace is written with (none for the dialecte's default
 * namespace, nor for no namespace). Without namespace declarations, the stored (possibly prefixed) name is written
 * literally, in no namespace.
 */
function createElementOf(params: {
	context: RecordElementContext
	record: AnyRawRecord
	parent: XmlElement | undefined
}): XmlElement {
	const { context, record, parent } = params
	const { namespace, tagName } = record
	if (!context.declareNamespaces) {
		const isDefaultNamespace = namespace.uri === context.config.namespaces.default.uri
		const isPrefixed = !isDefaultNamespace && !!namespace.prefix
		return createXmlElement({
			namespaceURI: null,
			qualifiedName: isPrefixed ? `${namespace.prefix}:${tagName}` : tagName,
			parent,
		})
	}
	const prefix = context.namespaces.declareOnRoot({
		uri: namespace.uri,
		storedPrefix: namespace.prefix,
	})
	return createXmlElement({
		namespaceURI: namespace.uri,
		qualifiedName: prefix ? `${prefix}:${tagName}` : tagName,
		parent,
	})
}

// ── Attributes ───────────────────────────────────────────────────────────────

/** The record's own attributes, in its order; namespace declarations are the writer's, not the record's. */
function addRecordAttributes(params: {
	context: RecordElementContext
	element: XmlElement
	attributes: AnyAttribute[]
}): void {
	const { context, element, attributes } = params
	for (const attribute of attributes) {
		// a record from another source (an earlier store, a hand-built list) may still hold one: never written
		if (isNamespaceDeclaration(attribute)) continue
		const value = String(attribute.value)
		if (!isQualifiedAttribute(attribute) || !attribute.namespace.prefix) {
			setAttribute({ element, qualifiedName: attribute.name, value })
			continue
		}
		const localName = extractLocalName(attribute.name)
		// without namespace declarations the prefixed name is written literally
		if (!context.declareNamespaces) {
			setAttribute({ element, qualifiedName: `${attribute.namespace.prefix}:${localName}`, value })
			continue
		}
		setQualifiedAttribute({ context, element, namespace: attribute.namespace, localName, value })
	}
}

/**
 * A namespaced attribute, written with the prefix its namespace takes on the root. An attribute in the dialecte's
 * default namespace cannot go unprefixed (an unprefixed attribute is in no namespace): it takes the default
 * namespace's alias prefix.
 */
function setQualifiedAttribute(params: {
	context: RecordElementContext
	element: XmlElement
	namespace: Namespace
	localName: string
	value: string
}): void {
	const { context, element, namespace, localName, value } = params
	if (namespace.uri === '') {
		setAttribute({ element, qualifiedName: localName, value })
		return
	}
	const chosen = context.namespaces.declareOnRoot({
		uri: namespace.uri,
		storedPrefix: namespace.prefix,
	})
	const prefix = chosen || context.namespaces.defaultAlias({ storedPrefix: namespace.prefix })
	setAttributeNS({
		element,
		namespaceURI: namespace.uri,
		qualifiedName: `${prefix}:${localName}`,
		value,
	})
}

/**
 * The `required` schema view (required and fixed attributes) the record does not hold, on a non-root element: an
 * export valid against the schema from a store that keeps what was written. Optional defaults are not added. An
 * element in another namespace than the declaration of its tag is not that declaration's element: nothing is added.
 */
function materializeRequiredAndFixedAttributes(params: {
	context: RecordElementContext
	element: XmlElement
	record: AnyRawRecord
}): void {
	const { context, element, record } = params
	const { config } = context
	// as declared under this parent: what a homonym requires differs from one parent to another; an element in
	// another namespace than that declaration's is not its element
	const definition = resolveDefinition({ dialecteConfig: config, record })
	if (!definition || definition.namespace.uri !== record.namespace.uri) return

	for (const [attributeName, attribute] of Object.entries(definition.attributes.details)) {
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

		if (attribute.namespace && attribute.namespace.prefix) {
			setQualifiedAttribute({
				context,
				element,
				namespace: attribute.namespace,
				localName,
				value,
			})
		} else {
			setAttribute({ element, qualifiedName: localName, value })
		}
	}
}

// ── xsi:type ─────────────────────────────────────────────────────────────────

/**
 * Write the element's xsi:type value with the prefix its namespace takes on the root: a name is bound by the
 * serializer, a value is not. A type in the dialecte's default namespace is written unprefixed where that default is
 * in force, else with the default namespace's alias prefix; a type in no namespace is written unprefixed only on an
 * element in no namespace (where no default is in force), else as stored. A value whose prefix core cannot read is
 * written as stored, and declares nothing.
 */
function writeXsiType(params: { context: RecordElementContext; element: XmlElement }): void {
	const { context, element } = params
	const value = getAttributeNS({ element, namespaceURI: XSI_NAMESPACE.uri, localName: 'type' })
	if (value === null) return
	const name = xsiTypeNameOf({
		value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig: context.config }),
	})
	if (name === undefined) return
	if (name.namespace === '' && element.namespaceURI !== '') return

	const prefix = valuePrefixOf({ context, element, uri: name.namespace })
	const xsiPrefix = context.namespaces.declareOnRoot({
		uri: XSI_NAMESPACE.uri,
		storedPrefix: XSI_NAMESPACE.prefix,
	})
	setAttributeNS({
		element,
		namespaceURI: XSI_NAMESPACE.uri,
		qualifiedName: `${xsiPrefix}:type`,
		value: prefix ? `${prefix}:${name.local}` : name.local,
	})
}

/**
 * The prefix a QName value in the namespace is written with on the element: the root's, unless that is unprefixed
 * (the dialecte's default) and another default is in force on the element, where the default namespace's alias is.
 */
function valuePrefixOf(params: {
	context: RecordElementContext
	element: XmlElement
	uri: string
}): string {
	const { context, element, uri } = params
	const prefix = context.namespaces.declareOnRoot({ uri, storedPrefix: undefined })
	if (prefix !== '' || uri === '') return prefix
	// the default in force on the element as written: the closest unprefixed element's, itself or an ancestor
	const inForce = lookupNamespaceURI({ element, prefix: null })
	return inForce === uri ? '' : context.namespaces.defaultAlias({ storedPrefix: undefined })
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
