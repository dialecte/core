import Dexie from 'dexie'

import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'

import type { AnyDatabaseInstance } from '@/database'
import type {
	AnyDialecteConfig,
	AnyQualifiedAttribute,
	AnyRawRecord,
	AnyAttribute,
	Namespace,
} from '@/types'

//====== PUBLIC FUNCTIONS ======//

/**
 * Generic XML export function that works with any dialecte
 * @param databaseName - Name of the database to export
 * @param dialecteConfig - Dialecte configuration with IO settings
 * @returns XML document and filename
 */
export async function exportXmlFile<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	extension: GenericConfig['io']['supportedFileExtensions'][number]
	dialecteConfig: GenericConfig
}): Promise<{ xmlDocument: XMLDocument; filename: string }> {
	const { databaseName, extension, dialecteConfig } = params
	return handleFileExportWithOptions({
		databaseName,
		extension,
		dialecteConfig,
		withDatabaseIds: false,
	})
}

export async function exportXmlDocumentForOpenSCD(params: {
	databaseName: string
	dialecteConfig: AnyDialecteConfig
}): Promise<{ xmlDocument: XMLDocument; filename: string }> {
	const { databaseName, dialecteConfig } = params
	return handleFileExportWithOptions({
		databaseName,
		dialecteConfig,
		withDatabaseIds: true,
	})
}

//====== PRIVATE FUNCTIONS ======//

async function handleFileExportWithOptions(params: {
	databaseName: string
	extension?: string
	dialecteConfig: AnyDialecteConfig
	withDatabaseIds: boolean
}) {
	const { databaseName, extension = 'xml', dialecteConfig, withDatabaseIds } = params

	const databaseInstance = new Dexie(databaseName) as AnyDatabaseInstance
	await databaseInstance.open()

	try {
		const xmlDocument = await rebuildXmlFromIndexedDB({
			databaseInstance,
			dialecteConfig,
			withDatabaseIds,
		})

		if (!xmlDocument) {
			throw new Error('Failed to rebuild XML document from IndexedDB.')
		}

		return {
			xmlDocument,
			filename: databaseInstance.name + extension,
		}
	} finally {
		databaseInstance.close()
	}
}

async function rebuildXmlFromIndexedDB(params: {
	databaseInstance: AnyDatabaseInstance
	dialecteConfig: AnyDialecteConfig
	withDatabaseIds: boolean
}) {
	const { databaseInstance, dialecteConfig, withDatabaseIds } = params

	const { useBrowserApi = true } = dialecteConfig.io.exportOptions ?? { useBrowserApi: true }
	const rootElementName = dialecteConfig.rootElementName
	const defaultNamespace = dialecteConfig.namespaces.default
	const elementsTableName = dialecteConfig.database.tables.xmlElements.name

	if (useBrowserApi) {
		const emptyXmlDocument = document.implementation.createDocument(
			defaultNamespace.uri,
			null,
			null,
		)

		const sclElement = (await databaseInstance
			.table(elementsTableName)
			.where({ tagName: rootElementName })
			.first()) as AnyRawRecord | undefined
		if (!sclElement) throw new Error(`No ${rootElementName} root element found in DB`)

		const rootElement = emptyXmlDocument.createElementNS(
			sclElement.namespace.uri,
			sclElement.tagName,
		)

		rootElement.setAttribute('xmlns', sclElement.namespace.uri)

		// Now add regular attributes, text content, etc.
		if (sclElement.attributes)
			addAttributesToElement({
				document: emptyXmlDocument,
				element: rootElement,
				attributes: sclElement.attributes,
				isRoot: true,
			})

		if (sclElement.value) rootElement.textContent = sclElement.value.trim()

		if (withDatabaseIds) rootElement.setAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME, sclElement.id)

		emptyXmlDocument.appendChild(rootElement)

		// Recursively build the tree structure
		return await recursivelyBuildXmlTree({
			databaseInstance,
			dialecteConfig,
			elementsTableName,
			withDatabaseIds,
			xmlDocument: emptyXmlDocument,
			databaseRecord: sclElement,
			parentDomElement: rootElement,
		})
	}
}

async function recursivelyBuildXmlTree(params: {
	databaseInstance: AnyDatabaseInstance
	dialecteConfig: AnyDialecteConfig
	elementsTableName: string
	withDatabaseIds: boolean
	xmlDocument: XMLDocument
	databaseRecord: AnyRawRecord
	parentDomElement: Element
}) {
	const {
		databaseInstance,
		dialecteConfig,
		elementsTableName,
		withDatabaseIds,
		xmlDocument,
		databaseRecord,
		parentDomElement,
	} = params

	if (!databaseRecord.children) return

	const childrenIds = databaseRecord.children.map((child) => child.id)
	const currentTable = databaseInstance.table(elementsTableName)
	const childrenRecords = (await currentTable.bulkGet(childrenIds)) as (AnyRawRecord | undefined)[]

	checkForDatabaseCorruption({
		childrenRecords,
		parentRecord: databaseRecord,
	})

	const orderedChildrenRecords = orderRecordsPerSpecifiedSequence({
		parentTagName: databaseRecord.tagName,
		availableChildren: dialecteConfig.children,
		childrenRecords: childrenRecords as AnyRawRecord[],
	})

	for (const childRecord of orderedChildrenRecords) {
		const childElement = createElementWithAttributesAndText({
			document: xmlDocument,
			record: childRecord,
			defaultNamespace: dialecteConfig.namespaces.default,
			withDatabaseIds,
		})

		// Add the child element to the parent DOM element
		parentDomElement.appendChild(childElement)

		await recursivelyBuildXmlTree({
			databaseInstance,
			dialecteConfig,
			elementsTableName,
			withDatabaseIds,
			xmlDocument,
			databaseRecord: childRecord,
			parentDomElement: childElement,
		})
	}

	return params.xmlDocument
}

function createElementWithAttributesAndText(params: {
	document: XMLDocument
	record: AnyRawRecord
	defaultNamespace: Namespace
	withDatabaseIds: boolean
}): Element {
	const { document, record, defaultNamespace, withDatabaseIds } = params
	let element: Element

	const isDefaultNamespace = record.namespace.uri === defaultNamespace.uri

	// Only add prefix if it's a non-default namespace with a valid prefix
	// Defensive: exclude 'xmlns' prefix (malformed namespace)
	if (!isDefaultNamespace && record.namespace.prefix && record.namespace.prefix !== 'xmlns') {
		addNamespaceToRootElementIfNeeded({
			document,
			namespace: record.namespace,
		})

		element = document.createElementNS(
			record.namespace.uri,
			`${record.namespace.prefix}:${record.tagName}`,
		)
	} else {
		element = document.createElementNS(record.namespace.uri, record.tagName)
	}

	if (record.attributes)
		addAttributesToElement({ document, element, attributes: record.attributes, isRoot: false })

	if (record.value) element.textContent = record.value.trim()

	if (withDatabaseIds) element.setAttribute(TEMP_IDB_ID_ATTRIBUTE_NAME, record.id)

	return element
}

function addAttributesToElement(params: {
	document: XMLDocument
	element: Element
	attributes: AnyAttribute[]
	isRoot: boolean
}) {
	const { document, element, attributes, isRoot } = params

	for (const attribute of attributes) {
		// Skip namespace declarations - they're metadata, not data attributes
		// They're handled separately via addNamespaceToRootElementIfNeeded
		if (isNamespaceDeclaration(attribute)) continue

		if (isQualifiedAttribute(attribute)) {
			const prefix = attribute.namespace?.prefix || ''

			if (!isRoot && prefix) {
				addNamespaceToRootElementIfNeeded({
					document,
					namespace: attribute.namespace,
				})
			}

			// attributes name value are stored without any prefix from the import by design
			// this is to ensure that manually added qualified attributes are not double-prefixed
			const localName = attribute.name.includes(':')
				? attribute.name.split(':').pop() || attribute.name
				: attribute.name

			const qualifiedName = prefix ? `${prefix}:${localName}` : localName

			element.setAttributeNS(attribute.namespace.uri, qualifiedName, String(attribute.value))
		} else element.setAttribute(attribute.name, String(attribute.value))
	}
}

function addNamespaceToRootElementIfNeeded(params: {
	document: XMLDocument
	namespace: { prefix: string; uri: string }
}) {
	const { document, namespace } = params
	const rootElement = document.documentElement
	if (!rootElement) return

	// Skip default namespace (empty prefix) - already set via xmlns attribute
	if (!namespace.prefix) return

	// Defensive: Skip if prefix is 'xmlns' (malformed namespace declaration)
	if (namespace.prefix === 'xmlns') return

	const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

	const existing = rootElement.getAttributeNS(XMLNS_NS, namespace.prefix)
	if (existing === null) {
		rootElement.setAttributeNS(XMLNS_NS, `xmlns:${namespace.prefix}`, namespace.uri)
	}
}

function orderRecordsPerSpecifiedSequence(params: {
	parentTagName: string
	availableChildren: AnyDialecteConfig['children']
	childrenRecords: AnyRawRecord[]
}): AnyRawRecord[] {
	const { parentTagName, availableChildren, childrenRecords } = params
	const orderedChildrenRecords: AnyRawRecord[] = []

	const childrenOrder = new Set<string>(availableChildren[parentTagName])

	if (!childrenOrder.size) return childrenRecords

	const childrenPerTagName = new Map<string, AnyRawRecord[]>()
	const unknowns: AnyRawRecord[] = []

	for (const tag of childrenOrder) {
		childrenPerTagName.set(tag, [])
	}

	for (const childRecord of childrenRecords) {
		if (childrenOrder.has(childRecord.tagName)) {
			childrenPerTagName.get(childRecord.tagName)?.push(childRecord)
		} else unknowns.push(childRecord)
	}

	for (const tag of childrenOrder) {
		const children = childrenPerTagName.get(tag)
		if (children && children.length) orderedChildrenRecords.push(...children)
	}

	orderedChildrenRecords.push(...unknowns)

	return orderedChildrenRecords
}

function checkForDatabaseCorruption(params: {
	childrenRecords: (AnyRawRecord | undefined)[]
	parentRecord: AnyRawRecord
}) {
	const { childrenRecords, parentRecord } = params

	const missingChildrenIndexes = childrenRecords
		.map((record, index) => (record === undefined ? index : -1))
		.filter((index) => index !== -1)

	if (missingChildrenIndexes.length > 0) {
		const missingChildren = missingChildrenIndexes.map((i) => {
			const childRef = parentRecord.children[i]
			return `'${childRef.tagName}' (id: ${childRef.id})`
		})

		throw new Error(
			`Database corruption detected: Parent element '${parentRecord.tagName}' (id: ${parentRecord.id}) ` +
				`references ${missingChildrenIndexes.length} non-existent child record(s): ${missingChildren.join(', ')}`,
		)
	}
}

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

/**
 * Identifies xmlns namespace declaration attributes that should not be set as regular attributes.
 * These are metadata that define namespace prefixes, not actual element attributes.
 * @param attribute - Attribute to check
 * @returns true if this is a namespace declaration (xmlns or xmlns:prefix)
 */
function isNamespaceDeclaration(attribute: AnyAttribute | AnyQualifiedAttribute): boolean {
	// Check for default namespace declaration: xmlns="..."
	if (attribute.name === 'xmlns') return true

	// Check for prefixed namespace declaration: xmlns:prefix="..."
	if (attribute.name.startsWith('xmlns:')) return true

	// Check if stored as qualified attribute with xmlns prefix
	if (isQualifiedAttribute(attribute) && attribute.namespace?.prefix === 'xmlns') return true

	return false
}
