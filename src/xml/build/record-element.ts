import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import { registerDefaultAlias, registerNamespace } from './root-namespaces'
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

import type { RecordElement, RecordElementSettings } from './record-element.types'
import type { NamespaceRegistration, NamespaceTable } from './root-namespaces.types'
import type { XmlElement } from './xml-element.types'
import type { AnyAttribute, AnyQualifiedAttribute, AnyRawRecord, Namespace } from '@/types'

/**
 * The element a record is written as, with what the document holds on it: its attributes, the required and fixed
 * attributes the schema asks for and the record does not hold (the root's come with the root start tag, once every
 * namespace is known), its xsi:type value written with the prefix its namespace takes, and its database id when asked.
 * Every namespace it uses is registered for the written root: the answer holds the table that grew. Its text and
 * children are the writer's.
 */
export function createRecordElement(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	record: AnyRawRecord
	parent: XmlElement | undefined
}): RecordElement {
	const { settings, table, record, parent } = params
	const { declareNamespaces, withDatabaseIds } = settings
	const named = createElementOf({ settings, table, record, parent })
	const { element } = named
	let grown = addRecordAttributes({
		settings,
		table: named.table,
		element,
		attributes: record.attributes,
	})
	// the root's required and fixed attributes are the root start tag's, once every namespace is known
	if (declareNamespaces && parent !== undefined) {
		grown = materializeRequiredAndFixedAttributes({ settings, table: grown, element, record })
	}
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) grown = writeXsiType({ settings, table: grown, element })
	return { element, table: grown }
}

/**
 * The element named after its record, with the prefix its namespace is written with (none for the dialecte's default
 * namespace, nor for no namespace). Without namespace declarations, the stored (possibly prefixed) name is written
 * literally, in no namespace.
 */
function createElementOf(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	record: AnyRawRecord
	parent: XmlElement | undefined
}): RecordElement {
	const { settings, table, record, parent } = params
	const { namespace, tagName } = record
	if (!settings.declareNamespaces) {
		const isDefaultNamespace = namespace.uri === settings.config.namespaces.default.uri
		const isPrefixed = !isDefaultNamespace && !!namespace.prefix
		const element = createXmlElement({
			namespaceURI: null,
			qualifiedName: isPrefixed ? `${namespace.prefix}:${tagName}` : tagName,
			parent,
		})
		return { element, table }
	}
	const registration = registerNamespace({
		table,
		config: settings.config,
		uri: namespace.uri,
		storedPrefix: namespace.prefix,
	})
	const { prefix } = registration
	const element = createXmlElement({
		namespaceURI: namespace.uri,
		qualifiedName: prefix ? `${prefix}:${tagName}` : tagName,
		parent,
	})
	return { element, table: registration.table }
}

// ── Attributes ───────────────────────────────────────────────────────────────

/** The record's own attributes, in its order; namespace declarations are the writer's, not the record's. */
function addRecordAttributes(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	attributes: AnyAttribute[]
}): NamespaceTable {
	const { settings, element, attributes } = params
	let { table } = params
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
		if (!settings.declareNamespaces) {
			setAttribute({ element, qualifiedName: `${attribute.namespace.prefix}:${localName}`, value })
			continue
		}
		table = setQualifiedAttribute({
			settings,
			table,
			element,
			namespace: attribute.namespace,
			localName,
			value,
		})
	}
	return table
}

/**
 * A namespaced attribute, written with the prefix its namespace takes on the root. An attribute in the dialecte's
 * default namespace cannot go unprefixed (an unprefixed attribute is in no namespace): it takes the default
 * namespace's alias prefix.
 */
function setQualifiedAttribute(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	namespace: Namespace
	localName: string
	value: string
}): NamespaceTable {
	const { settings, table, element, namespace, localName, value } = params
	if (namespace.uri === '') {
		setAttribute({ element, qualifiedName: localName, value })
		return table
	}
	const { config } = settings
	const chosen = registerNamespace({
		table,
		config,
		uri: namespace.uri,
		storedPrefix: namespace.prefix,
	})
	const written = chosen.prefix
		? chosen
		: registerDefaultAlias({ table: chosen.table, config, storedPrefix: namespace.prefix })
	setAttributeNS({
		element,
		namespaceURI: namespace.uri,
		qualifiedName: `${written.prefix}:${localName}`,
		value,
	})
	return written.table
}

/**
 * The `required` schema view (required and fixed attributes) the record does not hold, on a non-root element: an
 * export valid against the schema from a store that keeps what was written. Optional defaults are not added. An
 * element in another namespace than the declaration of its tag is not that declaration's element: nothing is added.
 */
function materializeRequiredAndFixedAttributes(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	record: AnyRawRecord
}): NamespaceTable {
	const { settings, element, record } = params
	const { config } = settings
	let { table } = params
	// as declared under this parent: what a homonym requires differs from one parent to another; an element in
	// another namespace than that declaration's is not its element
	const definition = resolveDefinition({ dialecteConfig: config, record })
	if (!definition || definition.namespace.uri !== record.namespace.uri) return table

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
			table = setQualifiedAttribute({
				settings,
				table,
				element,
				namespace: attribute.namespace,
				localName,
				value,
			})
		} else {
			setAttribute({ element, qualifiedName: localName, value })
		}
	}
	return table
}

// ── xsi:type ─────────────────────────────────────────────────────────────────

/**
 * Write the element's xsi:type value with the prefix its namespace takes on the root: a name is bound by the
 * serializer, a value is not. A type in the dialecte's default namespace is written unprefixed where that default is
 * in force, else with the default namespace's alias prefix; a type in no namespace is written unprefixed only on an
 * element in no namespace (where no default is in force), else as stored. A value whose prefix core cannot read is
 * written as stored, and declares nothing.
 */
function writeXsiType(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
}): NamespaceTable {
	const { settings, table, element } = params
	const { config } = settings
	const value = getAttributeNS({ element, namespaceURI: XSI_NAMESPACE.uri, localName: 'type' })
	if (value === null) return table
	const name = xsiTypeNameOf({
		value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig: config }),
	})
	if (name === undefined) return table
	if (name.namespace === '' && element.namespaceURI !== '') return table

	const valuePrefix = valuePrefixOf({ settings, table, element, uri: name.namespace })
	const xsi = registerNamespace({
		table: valuePrefix.table,
		config,
		uri: XSI_NAMESPACE.uri,
		storedPrefix: XSI_NAMESPACE.prefix,
	})
	setAttributeNS({
		element,
		namespaceURI: XSI_NAMESPACE.uri,
		qualifiedName: `${xsi.prefix}:type`,
		value: valuePrefix.prefix ? `${valuePrefix.prefix}:${name.local}` : name.local,
	})
	return xsi.table
}

/**
 * The prefix a QName value in the namespace is written with on the element: the root's, unless that is unprefixed
 * (the dialecte's default) and another default is in force on the element, where the default namespace's alias is.
 */
function valuePrefixOf(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	uri: string
}): NamespaceRegistration {
	const { settings, table, element, uri } = params
	const { config } = settings
	const registration = registerNamespace({ table, config, uri, storedPrefix: undefined })
	if (registration.prefix !== '' || uri === '') return registration
	// the default in force on the element as written: the closest unprefixed element's, itself or an ancestor
	const inForce = lookupNamespaceURI({ element, prefix: null })
	if (inForce === uri) return registration
	return registerDefaultAlias({ table: registration.table, config, storedPrefix: undefined })
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
