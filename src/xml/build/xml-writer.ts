import { createRecordElement, writtenRootUri } from './record-element'
import { emptyNamespaceTable, requiredRootAttributes, rootDeclarations } from './root-namespaces'
import {
	escapeCompactTextValue,
	escapeTextValue,
	qualifiedNameOf,
	serializeStartTag,
} from './xml-element'
import { EMPTY_SCOPE, INDENTATION, LINE_SEPARATOR, XML_DECLARATION } from './xml-writer.constants'

import { assertXmlCharacters } from '@/helpers/assert-xml-characters'
import { XML_NAMESPACE_URI } from '@/helpers/constant'
import { trimXmlWhitespace } from '@/utils/xml-whitespace'

import type { RecordElement, RecordElementSettings } from './record-element.types'
import type { NamespaceTable } from './root-namespaces.types'
import type { GeneratedPrefixes, NamespaceScope, XmlElement } from './xml-element.types'
import type { OpenedRecord, OpenElement, XmlWriter, XmlWriterParams } from './xml-writer.types'
import type { AnyRawRecord } from '@/types'

/**
 * A writer of records as XML text, element by element in document order, with no DOM, as `XMLSerializer` writes the
 * same elements: formatted (4 spaces, CRLF, a text value on its element's line) or compact. Every namespace the
 * records use is declared on the written root, and only there (but `xmlns=""` on an element in no namespace under a
 * default): the root start tag is only complete once every element is written, so the writer hands the body as it goes
 * (`take`) and the head (declaration and root start tag) at the end (`head`). It holds the streaming state only: the
 * open elements, the body not yet taken, the namespace table and the root.
 */
export function createXmlWriter(params: XmlWriterParams): XmlWriter {
	const { config, documentRoot, declareNamespaces = true, withDatabaseIds = false } = params
	const indent = params.indent ?? true
	const includeXmlDeclaration = params.includeXmlDeclaration ?? true
	const settings: RecordElementSettings = { config, declareNamespaces, withDatabaseIds }
	const openElements: OpenElement[] = []
	const body: string[] = []
	let table: NamespaceTable | undefined
	let root: OpenElement | undefined
	// the root's bindings, read where they are at each start tag: every namespace is declared on the root at the end
	const rootScope: NamespaceScope = {
		get bindings() {
			return table ? table.bindings : EMPTY_SCOPE.bindings
		},
		parent: undefined,
	}
	// the prefixes generated for the elements below the root, numbered across the document
	const prefixes: GeneratedPrefixes = { next: 1 }
	// a line break and the indentation of each level, made once
	const lineBreaks: string[] = []

	function lineBreak(level: number): string {
		lineBreaks[level] ??= LINE_SEPARATOR + INDENTATION.repeat(level)
		return lineBreaks[level]
	}

	function openElement(params: { record: AnyRawRecord }): void {
		const { record } = params
		const parent = openElements.at(-1)
		const created = elementOf({ settings, table, record, parent })
		// the table grown first: the start tag below reads the root's bindings as they now are
		table = created.table
		const { opened, startTag, text } = openRecord({
			element: created.element,
			record,
			value: created.text,
			parent,
			rootScope,
			prefixes,
			indent,
		})
		if (startTag === undefined) {
			root = opened
		} else {
			if (indent && !opened.insideInline) body.push(lineBreak(opened.level))
			body.push(startTag, opened.empty ? '/>' : '>')
		}
		openElements.push(opened)
		if (!text) return
		if (indent && !opened.inline) body.push(lineBreak(opened.level + 1))
		body.push(textOf({ text, indent }))
	}

	function closeElement(): void {
		const closed = openElements.pop()
		if (!closed || closed.empty) return
		if (indent && !closed.inline) body.push(lineBreak(closed.level))
		body.push(`</${closed.qualifiedName}>`)
	}

	function take(): string {
		return body.splice(0).join('')
	}

	function head(): string {
		if (!root || !table) return ''
		return headOf({ root, table, settings, documentRoot, indent, includeXmlDeclaration })
	}

	return { openElement, closeElement, take, head }
}

/**
 * The element of a record below its parent (none for the root), and the namespace table it grew: the root starts the
 * table.
 */
function elementOf(params: {
	settings: RecordElementSettings
	table: NamespaceTable | undefined
	record: AnyRawRecord
	parent: OpenElement | undefined
}): RecordElement {
	const { settings, record, parent } = params
	// a character XML does not allow could be written neither as is nor as a reference: refused, no file
	assertXmlCharacters({ record, withId: settings.withDatabaseIds })
	const table =
		parent && params.table
			? params.table
			: emptyNamespaceTable({
					config: settings.config,
					rootUri: writtenRootUri({ settings, record }),
				})
	return createRecordElement({ settings, table, record, parent: parent?.element })
}

/**
 * A record's element opened below its parent: the open element, its start tag where the parent's scope is in force
 * (none for the root, written at the end) and its text value.
 */
function openRecord(params: {
	element: XmlElement
	record: AnyRawRecord
	/** The record's text as written (a QName-typed text with its prefixes). */
	value: string
	parent: OpenElement | undefined
	rootScope: NamespaceScope
	prefixes: GeneratedPrefixes
	indent: boolean
}): OpenedRecord {
	const { element, record, value, parent, rootScope, prefixes, indent } = params
	// trimmed of XML whitespace only: a no-break space or a byte order mark is text
	const text = value ? trimXmlWhitespace({ text: value }) : ''
	const startTag = parent
		? serializeStartTag({ element, scope: parent.scope, prefixes })
		: undefined
	const opened = openedElementOf({
		element,
		parent,
		scope: startTag ? startTag.scope : rootScope,
		text,
		hasChildren: record.children.length > 0,
		indent,
	})
	return { opened, startTag: startTag?.text, text }
}

/** An element just opened: where it stands, and how its content is laid out. */
function openedElementOf(params: {
	element: XmlElement
	parent: OpenElement | undefined
	scope: NamespaceScope
	text: string
	hasChildren: boolean
	indent: boolean
}): OpenElement {
	const { element, parent, scope, text, hasChildren, indent } = params
	const insideInline = parent ? parent.inline || parent.insideInline : false
	return {
		element,
		qualifiedName: qualifiedNameOf(element),
		level: parent ? parent.level + 1 : 0,
		scope,
		empty: !text && !hasChildren,
		inline: !indent || insideInline || isInline({ element, text, hasChildren }),
		insideInline,
	}
}

/**
 * A text value as written: formatted, every line break as CRLF; compact, a carriage return as a reference (an XML
 * reader would turn it into a line feed).
 */
function textOf(params: { text: string; indent: boolean }): string {
	const { text, indent } = params
	if (!indent) return escapeCompactTextValue(text)
	return toLineSeparator(escapeTextValue(text))
}

/**
 * The XML declaration and the root start tag: the namespaces the written records use declared first, then the root's
 * own attributes, then the root attributes those namespaces require.
 */
function headOf(params: {
	root: OpenElement
	table: NamespaceTable
	settings: RecordElementSettings
	documentRoot: AnyRawRecord | undefined
	indent: boolean
	includeXmlDeclaration: boolean
}): string {
	const { root, table, settings, documentRoot, indent, includeXmlDeclaration } = params
	const { config } = settings
	const { element } = root
	const declarations = settings.declareNamespaces ? rootDeclarations({ table, config }) : []
	const required = requiredRootAttributes({ table, config, documentRoot, element })
	const { text: startTag } = serializeStartTag({
		element: { ...element, attributes: [...declarations, ...element.attributes, ...required] },
		scope: EMPTY_SCOPE,
		prefixes: { next: 1 },
	})
	const declaration = includeXmlDeclaration ? XML_DECLARATION + (indent ? LINE_SEPARATOR : '') : ''
	return declaration + startTag + (root.empty ? '/>' : '>')
}

/**
 * Whether the formatter keeps an element's content as written: `xml:space="preserve"`, or a text value alone, or a
 * one-line text value next to children (then the whole subtree stays on one line).
 */
function isInline(params: { element: XmlElement; text: string; hasChildren: boolean }): boolean {
	const { element, text, hasChildren } = params
	if (preservesSpace(element)) return true
	if (!text) return false
	return !hasChildren || !text.includes('\n')
}

function preservesSpace(element: XmlElement): boolean {
	return element.attributes.some(
		(attribute) =>
			attribute.value === 'preserve' &&
			((attribute.namespaceURI === XML_NAMESPACE_URI && attribute.localName === 'space') ||
				(attribute.namespaceURI === null && attribute.localName === 'xml:space')),
	)
}

/** Every line break of a value as the formatted layout writes it: CRLF. */
function toLineSeparator(text: string): string {
	if (!text.includes('\n')) return text
	return text.replace(/\r\n/g, '\n').replace(/\n/g, LINE_SEPARATOR)
}
