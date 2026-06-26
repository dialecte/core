import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'

import { invariant, orderByConfigSequence } from '@/utils'

import type { BuildXmlDocumentParams } from './build-xml-document.types'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	AnyAttribute,
	AnyQualifiedAttribute,
	Namespace,
} from '@/types'

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Build an XMLDocument from an array of records and a config.
 *
 * Pure function - no database calls.
 * Builds an in-memory index (Map<id, Record>) then traverses the tree depth-first.
 * Respects config.children ordering for element sequence.
 */
export function buildXmlDocument(params: BuildXmlDocumentParams): XMLDocument {
	const { records, config, withDatabaseIds = false, rootId } = params

	const index = new Map<string, AnyRawRecord>()
	let documentRootRecord: AnyRawRecord | undefined

	for (const record of records) {
		index.set(record.id, record)
		if (record.tagName === config.rootElementName) {
			documentRootRecord = record
		}
	}

	const rootRecord = rootId ? index.get(rootId) : documentRootRecord

	invariant(rootRecord, {
		detail: rootId
			? `No record found for rootId "${rootId}"`
			: `No ${config.rootElementName} root element found in records`,
		key: 'EXPORT_ROOT_NOT_FOUND',
	})

	// A fragment is any build whose root is not the document root element.
	// Root-only attribute enforcement is skipped for fragments.
	const isFragment = rootRecord.tagName !== config.rootElementName

	const defaultNamespace = config.namespaces.default

	const xmlDocument = document.implementation.createDocument(defaultNamespace.uri, null, null)

	// Build root element
	const rootElement = xmlDocument.createElementNS(rootRecord.namespace.uri, rootRecord.tagName)
	rootElement.setAttribute('xmlns', rootRecord.namespace.uri)

	if (rootRecord.attributes) {
		addAttributesToElement({
			config,
			document: xmlDocument,
			element: rootElement,
			attributes: rootRecord.attributes,
			tagName: rootRecord.tagName,
			isRoot: true,
			isFragment,
		})
	}

	if (!isFragment) {
		enforceRootAttributes({ config, rootElement, namespace: rootRecord.namespace })
	}

	if (rootRecord.value) rootElement.textContent = rootRecord.value.trim()
	if (withDatabaseIds) rootElement.setAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME, rootRecord.id)

	xmlDocument.appendChild(rootElement)

	// Recursively build tree from index
	buildChildren({
		index,
		config,
		withDatabaseIds,
		xmlDocument,
		parentRecord: rootRecord,
		parentElement: rootElement,
		isFragment,
	})

	return xmlDocument
}

// ── Tree traversal ───────────────────────────────────────────────────────────

function buildChildren(params: {
	index: Map<string, AnyRawRecord>
	config: AnyDialecteConfig
	withDatabaseIds: boolean
	xmlDocument: XMLDocument
	parentRecord: AnyRawRecord
	parentElement: Element
	isFragment: boolean
}): void {
	const { index, config, withDatabaseIds, xmlDocument, parentRecord, parentElement, isFragment } =
		params

	if (!parentRecord.children || parentRecord.children.length === 0) return

	const childRecords: AnyRawRecord[] = []
	for (const childRef of parentRecord.children) {
		const record = index.get(childRef.id)
		invariant(record, {
			detail: `Parent '${parentRecord.tagName}' references non-existent child '${childRef.tagName}' (id: ${childRef.id})`,
			key: 'EXPORT_ORPHAN_CHILD_REF',
			ref: { tagName: parentRecord.tagName, id: parentRecord.id },
		})
		childRecords.push(record)
	}

	const orderedChildren = orderByConfigSequence({
		parentTagName: parentRecord.tagName,
		children: childRecords,
		childrenConfig: config.children,
	})

	for (const childRecord of orderedChildren) {
		const childElement = createElementWithAttributesAndText({
			config,
			document: xmlDocument,
			record: childRecord,
			defaultNamespace: config.namespaces.default,
			withDatabaseIds,
			isFragment,
		})

		parentElement.appendChild(childElement)

		buildChildren({
			index,
			config,
			withDatabaseIds,
			xmlDocument,
			parentRecord: childRecord,
			parentElement: childElement,
			isFragment,
		})
	}
}

// ── Element creation ─────────────────────────────────────────────────────────

function createElementWithAttributesAndText(params: {
	config: AnyDialecteConfig
	document: XMLDocument
	record: AnyRawRecord
	defaultNamespace: Namespace
	withDatabaseIds: boolean
	isFragment: boolean
}): Element {
	const { config, document: doc, record, defaultNamespace, withDatabaseIds, isFragment } = params

	const isDefaultNamespace = record.namespace.uri === defaultNamespace.uri
	let element: Element

	if (!isDefaultNamespace && record.namespace.prefix && record.namespace.prefix !== 'xmlns') {
		addNamespaceToRootElementIfNeeded({
			config,
			document: doc,
			namespace: record.namespace,
			isFragment,
		})
		element = doc.createElementNS(
			record.namespace.uri,
			`${record.namespace.prefix}:${record.tagName}`,
		)
	} else {
		element = doc.createElementNS(record.namespace.uri, record.tagName)
	}

	if (record.attributes) {
		addAttributesToElement({
			config,
			document: doc,
			element,
			attributes: record.attributes,
			tagName: record.tagName,
			isRoot: false,
			isFragment,
		})
	}

	if (record.value) element.textContent = record.value.trim()
	if (withDatabaseIds) element.setAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME, record.id)

	return element
}

// ── Attributes ───────────────────────────────────────────────────────────────

function addAttributesToElement(params: {
	config: AnyDialecteConfig
	document: XMLDocument
	element: Element
	attributes: AnyAttribute[]
	tagName: string
	isRoot: boolean
	isFragment: boolean
}): void {
	const { config, document: doc, element, attributes, tagName, isRoot, isFragment } = params

	for (const attribute of attributes) {
		if (isNamespaceDeclaration(attribute)) continue
		const isAttributeSet = attribute.value
		if (!isRoot && !isAttributeSet && shouldSkipDefaultAttribute({ config, tagName, attribute })) {
			continue
		}

		if (!isQualifiedAttribute(attribute) || !attribute.namespace.prefix) {
			element.setAttribute(attribute.name, String(attribute.value))
			continue
		}

		if (!isRoot) {
			addNamespaceToRootElementIfNeeded({
				config,
				document: doc,
				namespace: attribute.namespace,
				isFragment,
			})
		}

		const localName = extractLocalName(attribute.name)
		element.setAttributeNS(
			attribute.namespace.uri,
			`${attribute.namespace.prefix}:${localName}`,
			String(attribute.value),
		)
	}
}

// ── Namespace helpers ────────────────────────────────────────────────────────

function addNamespaceToRootElementIfNeeded(params: {
	config: AnyDialecteConfig
	document: XMLDocument
	namespace: { prefix: string; uri: string }
	isFragment: boolean
}): void {
	const { config, document: doc, namespace, isFragment } = params
	const rootElement = doc.documentElement
	if (!rootElement) return
	if (!namespace.prefix) return
	if (namespace.prefix === 'xmlns') return

	const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
	const existing = rootElement.getAttributeNS(XMLNS_NS, namespace.prefix)
	if (existing === null) {
		rootElement.setAttributeNS(XMLNS_NS, `xmlns:${namespace.prefix}`, namespace.uri)
		if (!isFragment) {
			enforceRootAttributes({ config, rootElement, namespace })
		}
	}
}

function enforceRootAttributes(params: {
	config: AnyDialecteConfig
	rootElement: Element
	namespace: { prefix: string; uri: string }
}): void {
	const { config, rootElement, namespace } = params

	const matchingRootAttributes = Object.entries(
		config.definition[config.rootElementName].attributes.details,
	).filter(([_, attribute]) => {
		const isDefaultNamespace = namespace.uri === config.namespaces.default.uri
		if (isDefaultNamespace) return !attribute.namespace

		const isQualifiedAttributeToBeAdded =
			attribute.namespace?.prefix === namespace.prefix && attribute.namespace?.uri === namespace.uri
		return isQualifiedAttributeToBeAdded
	})

	const hasMatchingAttributes = matchingRootAttributes.length > 0
	if (!hasMatchingAttributes) return

	for (const [attributeName, attribute] of matchingRootAttributes) {
		const localName = extractLocalName(attributeName)

		const attributeExists = attribute.namespace
			? rootElement.hasAttributeNS(attribute.namespace.uri, localName)
			: rootElement.hasAttribute(localName)

		if (attributeExists) continue

		if (attribute.namespace) {
			const qualifiedName = `${attribute.namespace.prefix}:${localName}`
			rootElement.setAttributeNS(attribute.namespace.uri, qualifiedName, attribute.default || '')
		} else {
			rootElement.setAttribute(localName, attribute.default || '')
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractLocalName(name: string): string {
	const colonIndex = name.lastIndexOf(':')
	return colonIndex === -1 ? name : name.slice(colonIndex + 1)
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isQualifiedAttribute(
	attribute: AnyAttribute | AnyQualifiedAttribute | null,
): attribute is AnyQualifiedAttribute {
	return (
		attribute !== null &&
		typeof attribute === 'object' &&
		'namespace' in attribute &&
		!!attribute.namespace
	)
}

function isNamespaceDeclaration(attribute: AnyAttribute | AnyQualifiedAttribute): boolean {
	if (attribute.name === 'xmlns') return true
	if (attribute.name.startsWith('xmlns:')) return true
	if (isQualifiedAttribute(attribute) && attribute.namespace?.prefix === 'xmlns') return true
	return false
}

function shouldSkipDefaultAttribute(params: {
	config: AnyDialecteConfig
	tagName: string
	attribute: AnyAttribute | AnyQualifiedAttribute
}): boolean {
	const { config, tagName, attribute } = params

	if (!config.elements.includes(tagName)) return false

	const definition = config.definition[tagName]
	if (!definition) return false

	const details = definition.attributes.details[attribute.name]
	if (!details || details.required) return false

	const identityFields = definition.attributes.identityFields
	if (identityFields?.includes(attribute.name)) return false

	return true
}
