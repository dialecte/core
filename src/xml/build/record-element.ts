import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import { NO_DEFAULT_DECLARATION } from './record-element.constants'
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
import { extractLocalName, resolveSchemaAttributeValue } from '@/utils'
import { declaredAttributeTypeOf, declaredDefinitionOf } from '@/utils/qname-definition'
import { mayHoldQualifiedNames, readsQualifiedNames } from '@/utils/qname-typed'
import { itemsOf, qualifiedNameTypeOf, storedNamespaceLookup } from '@/utils/qname-value'
import { qualifiedNameOf } from '@/utils/qualified-name'
import { isXsiTypeAttribute } from '@/utils/xsi-type'

import type { RecordElement, RecordElementSettings } from './record-element.types'
import type { NamespaceRegistration, NamespaceTable } from './root-namespaces.types'
import type { XmlElement } from './xml-element.types'
import type {
	AnyAttribute,
	AnyQualifiedAttribute,
	AnyRawRecord,
	DataType,
	Namespace,
	ResolvedDefinition,
} from '@/types'

/**
 * The element a record is written as, with what the document holds on it: its attributes, the required and fixed
 * attributes the schema asks for and the record does not hold (the root's come with the root start tag, once every
 * namespace is known), its xsi:type and QName-typed values written with the prefix their namespaces take, and its
 * database id when asked. Every namespace it uses is registered for the written root: the answer holds the table that
 * grew, and the text as written (a QName-typed text with its prefixes). Its children are the writer's.
 */
export function createRecordElement(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	record: AnyRawRecord
	parent: XmlElement | undefined
}): RecordElement {
	const { settings, table, record, parent } = params
	const { config, declareNamespaces, withDatabaseIds } = settings
	const holdsQualifiedNames =
		declareNamespaces && mayHoldQualifiedNames({ dialecteConfig: config, tagName: record.tagName })
	// the root's required and fixed attributes are the root start tag's, once every namespace is known
	const materializes = declareNamespaces && parent !== undefined
	// as declared under this parent: what a homonym holds differs from one parent to another; an element in another
	// namespace than that declaration's is not its element
	const definition =
		materializes || holdsQualifiedNames
			? declaredDefinitionOf({ dialecteConfig: config, record })
			: undefined
	// a name in no namespace is written unprefixed where no default is in force: the element is made one (the written
	// root binds no default then: `writtenRootUri`)
	const holdsNoNamespaceName = declareNamespaces && namesNoNamespace({ config, record, definition })
	const named = createElementOf({ settings, table, record, parent, holdsNoNamespaceName })
	const { element } = named
	let grown = addRecordAttributes({
		settings,
		table: named.table,
		element,
		attributes: record.attributes,
	})
	let text = record.value
	if (definition !== undefined && holdsQualifiedNames) {
		const written = writeQNameValues({ settings, table: grown, element, record, definition })
		grown = written.table
		text = written.text
	}
	if (definition !== undefined && materializes) {
		grown = materializeRequiredAndFixedAttributes({
			settings,
			table: grown,
			element,
			record,
			definition,
		})
	}
	if (withDatabaseIds) {
		setAttribute({ element, qualifiedName: TEMP_IDB_ID_ATTRIBUTE_NAME, value: record.id })
	}
	if (declareNamespaces) grown = writeXsiType({ settings, table: grown, element })
	return { element, table: grown, text }
}

/**
 * The element named after its record, with the prefix its namespace is written with (none for the dialecte's default
 * namespace, nor for no namespace). Without namespace declarations, the stored (possibly prefixed) name is written
 * literally, in no namespace. An element holding a qualified name in no namespace is made one where no default is in
 * force (`elementWithoutDefault`).
 */
function createElementOf(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	record: AnyRawRecord
	parent: XmlElement | undefined
	/** The record names a qualified name in no namespace (`namesNoNamespace`). */
	holdsNoNamespaceName: boolean
}): Omit<RecordElement, 'text'> {
	const { settings, table, record, parent, holdsNoNamespaceName } = params
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
	if (holdsNoNamespaceName) return elementWithoutDefault({ settings, registration, record, parent })
	const { prefix } = registration
	const element = createXmlElement({
		namespaceURI: namespace.uri,
		qualifiedName: prefix ? `${prefix}:${tagName}` : tagName,
		parent,
	})
	return { element, table: registration.table }
}

/**
 * The element of a record naming a qualified name in no namespace, made one where no default is in force so the name
 * is written unprefixed: an element of the default namespace takes the default namespace's alias prefix (its name
 * keeps its namespace), and `xmlns=""` is declared on it, first, where its parent still has a default in force (an
 * undeclaring ancestor's is in scope already; the written root has none: it binds no default). Its descendants in
 * the default namespace declare it again where they stand. An element where no default is in force (in no namespace,
 * or under an undeclaring ancestor) is written as it is.
 */
function elementWithoutDefault(params: {
	settings: RecordElementSettings
	registration: NamespaceRegistration
	record: AnyRawRecord
	parent: XmlElement | undefined
}): Omit<RecordElement, 'text'> {
	const { settings, registration, record, parent } = params
	const { namespace, tagName } = record
	const unprefixed = !registration.prefix && namespace.uri !== ''
	const inForceAtParent = parent && lookupNamespaceURI({ element: parent, prefix: null })
	const alias = unprefixed
		? registerDefaultAlias({
				table: registration.table,
				config: settings.config,
				storedPrefix: undefined,
			})
		: registration
	const named = createXmlElement({
		namespaceURI: namespace.uri,
		qualifiedName: alias.prefix ? `${alias.prefix}:${tagName}` : tagName,
		parent,
	})
	const undeclares = !!inForceAtParent && namespace.uri !== ''
	const element = undeclares ? { ...named, attributes: [{ ...NO_DEFAULT_DECLARATION }] } : named
	return { element, table: alias.table }
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
	definition: ResolvedDefinition
}): NamespaceTable {
	const { settings, element, record, definition } = params
	const { config } = settings
	let { table } = params

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
	const written = writtenQualifiedName({ settings, table, element, value, notation: false })
	if (written === undefined) return table
	const xsi = registerNamespace({
		table: written.table,
		config,
		uri: XSI_NAMESPACE.uri,
		storedPrefix: XSI_NAMESPACE.prefix,
	})
	setAttributeNS({
		element,
		namespaceURI: XSI_NAMESPACE.uri,
		qualifiedName: `${xsi.prefix}:type`,
		value: written.value,
	})
	return xsi.table
}

// ── QName-typed values ───────────────────────────────────────────────────────

/**
 * Write the record's QName-typed attribute values with the prefixes their namespaces take on the root, as xsi:type
 * is, and give its QName-typed text as written. A list is written item by item.
 */
function writeQNameValues(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	record: AnyRawRecord
	definition: ResolvedDefinition
}): { table: NamespaceTable; text: string } {
	const { settings, element, record, definition } = params
	let { table } = params
	for (const attribute of record.attributes) {
		const type = declaredAttributeTypeOf({ definition, attribute })
		if (type === undefined || !readsQualifiedNames(type)) continue
		const written = writtenValue({ settings, table, element, type, value: String(attribute.value) })
		table = written.table
		if (isQualifiedAttribute(attribute) && attribute.namespace.prefix) {
			setAttributeNS({
				element,
				namespaceURI: attribute.namespace.uri,
				qualifiedName: extractLocalName(attribute.name),
				value: written.value,
			})
		} else {
			setAttribute({ element, qualifiedName: attribute.name, value: written.value })
		}
	}
	const textType = definition.textContent?.type
	if (textType === undefined || !readsQualifiedNames(textType) || record.value === '')
		return { table, text: record.value }
	const text = writtenValue({ settings, table, element, type: textType, value: record.value })
	return { table: text.table, text: text.value }
}

/**
 * A stored QName-typed value as written: each name with its root prefix; a list item by item; a union as the member
 * that reads it (`qualifiedNameTypeOf`), a value of another member as stored.
 */
function writtenValue(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	type: DataType
	value: string
}): { table: NamespaceTable; value: string } {
	const { settings, element, value } = params
	let { table } = params
	const type = qualifiedNameTypeOf({
		type: params.type,
		value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig: settings.config }),
	})
	if (type === undefined) return { table, value }
	if ('builtin' in type) {
		const notation = type.builtin === 'NOTATION'
		const written = writtenQualifiedName({ settings, table, element, value, notation })
		return written ?? { table, value }
	}
	const items: string[] = []
	for (const item of itemsOf(value)) {
		const written = writtenValue({ settings, table, element, type: type.list, value: item })
		table = written.table
		items.push(written.value)
	}
	return { table, value: items.join(' ') }
}

/**
 * A stored qualified name (xsi:type or a QName-typed value) as written on the element: a name in the dialecte's
 * default namespace unprefixed where that default is in force, else with the default namespace's alias prefix (and
 * a NOTATION always with the alias: libxml2 reads an unprefixed NOTATION in no namespace); a name in no namespace
 * unprefixed only on an element in no namespace, else as stored. `undefined` for a value whose prefix core cannot
 * read: written as stored, declaring nothing.
 */
function writtenQualifiedName(params: {
	settings: RecordElementSettings
	table: NamespaceTable
	element: XmlElement
	value: string
	notation: boolean
}): { table: NamespaceTable; value: string } | undefined {
	const { settings, table, element, value, notation } = params
	const name = qualifiedNameOf({
		value,
		namespaceOf: storedNamespaceLookup({ dialecteConfig: settings.config }),
	})
	if (name === undefined) return undefined
	if (name.namespace === '') {
		// unprefixed only where no default is in force (`elementWithoutDefault` saw to it below the root), else as stored;
		// an element in no namespace finds itself (`''`): no default there either
		if (lookupNamespaceURI({ element, prefix: null })) return undefined
		return { table, value: name.local }
	}
	const valuePrefix = valuePrefixOf({ settings, table, element, uri: name.namespace })
	const written =
		notation && valuePrefix.prefix === '' && name.namespace !== ''
			? registerDefaultAlias({
					table: valuePrefix.table,
					config: settings.config,
					storedPrefix: undefined,
				})
			: valuePrefix
	return {
		table: written.table,
		value: written.prefix ? `${written.prefix}:${name.local}` : name.local,
	}
}

/**
 * The namespace the written root binds as the default: the dialecte's default namespace when the root is in it and
 * names no qualified name in no namespace, else none (`''`). A name in no namespace is written unprefixed only where
 * no default is in force: such a root is written under the default namespace's alias. A root outside the default
 * namespace (a fragment of another namespace) binds none either, so an element below it knows where a default is in
 * force: each element below in the default namespace declares it on itself.
 *
 * @internal the default of the namespace table a document or fragment export starts with
 */
export function writtenRootUri(params: {
	settings: RecordElementSettings
	record: AnyRawRecord
}): string {
	const { settings, record } = params
	const { config, declareNamespaces } = settings
	if (!declareNamespaces) return record.namespace.uri
	if (record.namespace.uri !== config.namespaces.default.uri) return ''
	const definition = mayHoldQualifiedNames({ dialecteConfig: config, tagName: record.tagName })
		? declaredDefinitionOf({ dialecteConfig: config, record })
		: undefined
	return namesNoNamespace({ config, record, definition }) ? '' : record.namespace.uri
}

/**
 * Whether the record names a qualified name in no namespace (stored `{}local`): its xsi:type, or a QName-typed value
 * of the definition that applies (an item of a list, its text).
 */
function namesNoNamespace(params: {
	config: RecordElementSettings['config']
	record: AnyRawRecord
	definition: ResolvedDefinition | undefined
}): boolean {
	const { record, definition, config } = params
	// read only for a value naming `{}local`: most records name none
	function namesQualified(type: DataType | undefined, value: string): boolean {
		if (type === undefined) return false
		const namespaceOf = storedNamespaceLookup({ dialecteConfig: config })
		return qualifiedNameTypeOf({ type, value, namespaceOf }) !== undefined
	}
	for (const attribute of record.attributes) {
		if (typeof attribute.value !== 'string' || !isNoNamespace(attribute.value)) continue
		if (isXsiTypeAttribute(attribute)) return true
		const type = definition && declaredAttributeTypeOf({ definition, attribute })
		if (namesQualified(type, attribute.value)) return true
	}
	return isNoNamespace(record.value) && namesQualified(definition?.textContent?.type, record.value)
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

/** Whether a stored qualified name, or an item of a stored list, is in no namespace (`{}local`). */
function isNoNamespace(value: string): boolean {
	return itemsOf(value).some((item) => item.startsWith('{}'))
}
