import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'

import {
	extractLocalName,
	invariant,
	orderByConfigSequence,
	resolveSchemaAttributeValue,
} from '@/utils'

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
	const { records, config, withDatabaseIds = false, rootId, declareNamespaces = true } = params

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
	const rootElement = createRecordElement({
		document: xmlDocument,
		record: rootRecord,
		defaultNamespace,
		declareNamespaces,
	})
	if (declareNamespaces) rootElement.setAttribute('xmlns', rootRecord.namespace.uri)

	if (rootRecord.attributes) {
		addAttributesToElement({
			config,
			document: xmlDocument,
			element: rootElement,
			attributes: rootRecord.attributes,
			isRoot: true,
			isFragment,
			declareNamespaces,
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
		declareNamespaces,
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
	declareNamespaces: boolean
}): void {
	const {
		index,
		config,
		withDatabaseIds,
		xmlDocument,
		parentRecord,
		parentElement,
		isFragment,
		declareNamespaces,
	} = params

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
			declareNamespaces,
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
			declareNamespaces,
		})
	}
}

// ── Element creation ─────────────────────────────────────────────────────────

/**
 * Create an element for a record. With `declareNamespaces` (default), namespaced
 * elements are created NS-aware (`createElementNS`) so the serializer emits the
 * matching `xmlns`/`xmlns:*` on the root. Without it, the element is created with
 * its literal (possibly prefixed) tag name in no namespace, so the serializer
 * emits no namespace declarations — yielding a bare fragment.
 */
function createRecordElement(params: {
	document: XMLDocument
	record: AnyRawRecord
	defaultNamespace: Namespace
	declareNamespaces: boolean
}): Element {
	const { document: doc, record, defaultNamespace, declareNamespaces } = params
	const isDefaultNamespace = record.namespace.uri === defaultNamespace.uri
	const isPrefixed =
		!isDefaultNamespace && !!record.namespace.prefix && record.namespace.prefix !== 'xmlns'
	const qualifiedName = isPrefixed ? `${record.namespace.prefix}:${record.tagName}` : record.tagName

	if (!declareNamespaces) return doc.createElement(qualifiedName)
	return doc.createElementNS(record.namespace.uri, qualifiedName)
}

function createElementWithAttributesAndText(params: {
	config: AnyDialecteConfig
	document: XMLDocument
	record: AnyRawRecord
	defaultNamespace: Namespace
	withDatabaseIds: boolean
	isFragment: boolean
	declareNamespaces: boolean
}): Element {
	const {
		config,
		document: doc,
		record,
		defaultNamespace,
		withDatabaseIds,
		isFragment,
		declareNamespaces,
	} = params

	const isDefaultNamespace = record.namespace.uri === defaultNamespace.uri
	const element = createRecordElement({
		document: doc,
		record,
		defaultNamespace,
		declareNamespaces,
	})

	if (
		declareNamespaces &&
		!isDefaultNamespace &&
		record.namespace.prefix &&
		record.namespace.prefix !== 'xmlns'
	) {
		addNamespaceToRootElementIfNeeded({
			config,
			document: doc,
			namespace: record.namespace,
			isFragment,
		})
	}

	if (record.attributes) {
		addAttributesToElement({
			config,
			document: doc,
			element,
			attributes: record.attributes,
			isRoot: false,
			isFragment,
			declareNamespaces,
		})
	}

	materializeRequiredAndFixedAttributes({
		config,
		document: doc,
		element,
		tagName: record.tagName,
		isFragment,
		declareNamespaces,
	})

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
	isRoot: boolean
	isFragment: boolean
	declareNamespaces: boolean
}): void {
	const {
		config,
		document: doc,
		element,
		attributes,
		isRoot,
		isFragment,
		declareNamespaces,
	} = params

	for (const attribute of attributes) {
		if (isNamespaceDeclaration(attribute)) continue

		if (!isQualifiedAttribute(attribute) || !attribute.namespace.prefix) {
			element.setAttribute(attribute.name, String(attribute.value))
			continue
		}

		const localName = extractLocalName(attribute.name)

		// Bare-fragment mode: write the prefixed name literally, no xmlns declaration.
		if (!declareNamespaces) {
			element.setAttribute(`${attribute.namespace.prefix}:${localName}`, String(attribute.value))
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
	).filter(([attributeName, attribute]) => {
		// Materialize only the `required` view (required + fixed); optional default-only
		// attributes are not reintroduced, keeping the store faithful.
		const value = resolveSchemaAttributeValue({
			dialecteConfig: config,
			tagName: config.rootElementName,
			attributeName,
			defaults: 'required',
		})
		if (value === undefined) return false

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
		const value =
			resolveSchemaAttributeValue({
				dialecteConfig: config,
				tagName: config.rootElementName,
				attributeName,
				defaults: 'required',
			}) ?? ''

		const attributeExists = attribute.namespace
			? rootElement.hasAttributeNS(attribute.namespace.uri, localName)
			: rootElement.hasAttribute(localName)

		if (attributeExists) continue

		if (attribute.namespace) {
			const qualifiedName = `${attribute.namespace.prefix}:${localName}`
			rootElement.setAttributeNS(attribute.namespace.uri, qualifiedName, value)
		} else {
			rootElement.setAttribute(localName, value)
		}
	}
}

// ── Schema materialization ───────────────────────────────────────────────────

/**
 * Materialize the `required` schema view (required + fixed attributes) that is absent
 * from a non-root element, for XSD validity against a faithful store. Values come from
 * the shared `resolveSchemaAttributeValue`, so export stays in lockstep with the read
 * `defaults: 'required'` view. Optional default-only attributes are NOT materialized —
 * the store stays faithful and export does not reintroduce omitted defaults.
 */
function materializeRequiredAndFixedAttributes(params: {
	config: AnyDialecteConfig
	document: XMLDocument
	element: Element
	tagName: string
	isFragment: boolean
	declareNamespaces: boolean
}): void {
	const { config, document: doc, element, tagName, isFragment, declareNamespaces } = params

	// Bare-fragment mode (no namespace declarations) is a minimal literal snippet
	// view, not a schema-valid document — skip materialization there.
	if (!declareNamespaces) return

	const details = config.definition[tagName]?.attributes.details
	if (!details) return

	for (const [attributeName, attribute] of Object.entries(details)) {
		const value = resolveSchemaAttributeValue({
			dialecteConfig: config,
			tagName,
			attributeName,
			defaults: 'required',
		})
		if (value === undefined) continue

		const localName = extractLocalName(attributeName)
		const exists = attribute.namespace
			? element.hasAttributeNS(attribute.namespace.uri, localName)
			: element.hasAttribute(localName)
		if (exists) continue

		if (
			attribute.namespace &&
			attribute.namespace.prefix &&
			attribute.namespace.prefix !== 'xmlns'
		) {
			if (declareNamespaces) {
				addNamespaceToRootElementIfNeeded({
					config,
					document: doc,
					namespace: attribute.namespace,
					isFragment,
				})
			}
			element.setAttributeNS(
				attribute.namespace.uri,
				`${attribute.namespace.prefix}:${localName}`,
				value,
			)
		} else {
			element.setAttribute(localName, value)
		}
	}
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
