import { isDocumentRoot } from './document-root'
import { XmlWriter } from './xml-writer'

import { invariant, orderByConfigSequence } from '@/utils'

import type { WriteXmlRecordsParams } from './write-xml-records.types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/**
 * Write a document (or the fragment rooted at `rootId`) held as a list of records: the bytes the store's export
 * writes for the same records. Children follow the dialecte's sequence.
 */
export function writeXmlRecords(params: WriteXmlRecordsParams): string {
	const {
		records,
		config,
		rootId,
		indent,
		declareNamespaces,
		includeXmlDeclaration,
		withDatabaseIds,
	} = params
	const index = new Map<string, AnyRawRecord>()
	for (const record of records) index.set(record.id, record)

	const rootRecord = rootId ? index.get(rootId) : findDocumentRoot({ records, config })
	invariant(rootRecord, {
		detail: rootId
			? `No record found for rootId "${rootId}"`
			: `No ${config.rootElementName} root element found in records`,
		key: 'EXPORT_ROOT_NOT_FOUND',
	})

	const writer = new XmlWriter({
		config,
		documentRoot: rootRecord.tagName === config.rootElementName ? rootRecord : undefined,
		indent,
		declareNamespaces,
		includeXmlDeclaration,
		withDatabaseIds,
	})
	writeElement({ writer, record: rootRecord, index, config })
	const body = writer.take()
	return writer.head() + body
}

/** The record of the document's root element: the root tag, with no parent. */
function findDocumentRoot(params: {
	records: AnyRawRecord[]
	config: AnyDialecteConfig
}): AnyRawRecord | undefined {
	const { records, config } = params
	return records.find((record) => isDocumentRoot({ record, config }))
}

function writeElement(params: {
	writer: XmlWriter
	record: AnyRawRecord
	index: Map<string, AnyRawRecord>
	config: AnyDialecteConfig
}): void {
	const { writer, record, index, config } = params
	writer.openElement({ record })
	const children = orderByConfigSequence({
		parentTagName: record.tagName,
		children: record.children,
		childrenConfig: config.children,
		definition: config.definition,
	})
	for (const child of children) {
		const childRecord = index.get(child.id)
		invariant(childRecord, {
			detail: `Parent '${record.tagName}' references non-existent child '${child.tagName}' (id: ${child.id})`,
			key: 'EXPORT_ORPHAN_CHILD_REF',
			ref: { tagName: record.tagName, id: record.id },
		})
		writeElement({ writer, record: childRecord, index, config })
	}
	writer.closeElement()
}
