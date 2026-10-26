import { createRecordElement } from './record-element'
import {
	escapeCompactTextValue,
	escapeTextValue,
	qualifiedNameOf,
	serializeStartTag,
} from './xml-element'
import {
	EMPTY_SCOPE,
	INDENTATION,
	LINE_SEPARATOR,
	XML_DECLARATION,
	XML_NAMESPACE_URI,
} from './xml-writer.constants'

import type { RecordElementContext } from './record-element.types'
import type { GeneratedPrefixes, NamespaceScope, XmlElement } from './xml-element.types'
import type { OpenElement, XmlWriterParams } from './xml-writer.types'
import type { AnyRawRecord } from '@/types'

/**
 * Write records as XML text, element by element in document order, with no DOM, as `XMLSerializer` writes the same
 * elements: formatted (4 spaces, CRLF, a text value on its element's line) or compact. The root start tag is only
 * complete once every element is written (the namespaces the document needs are declared on it as they are met), so
 * the writer hands the body as it goes (`take`) and the head (declaration and root start tag) at the end (`head`).
 */
export class XmlWriter {
	private readonly context: RecordElementContext
	private readonly indent: boolean
	private readonly includeXmlDeclaration: boolean
	private readonly openElements: OpenElement[] = []
	private body: string[] = []
	private root: OpenElement | undefined
	/** The root's bindings as they stand: its declarations grow while its descendants are written. */
	private readonly rootBindings = new Map<string, string>()
	private readonly rootScope: NamespaceScope = { bindings: this.rootBindings, parent: undefined }
	private rootAttributeCount = -1
	/** The prefixes generated for the elements below the root, numbered across the document */
	private readonly prefixes: GeneratedPrefixes = { next: 1 }
	/** A line break and the indentation of each level, made once */
	private readonly newLines: string[] = []

	constructor(params: XmlWriterParams) {
		const { config, documentRoot, declareNamespaces = true, withDatabaseIds = false } = params
		this.context = {
			config,
			declareNamespaces,
			withDatabaseIds,
			documentRoot,
			rootElement: undefined,
		}
		this.indent = params.indent ?? true
		this.includeXmlDeclaration = params.includeXmlDeclaration ?? true
	}

	/** Open the element of the next record in document order (the first is the written root). */
	openElement(params: { record: AnyRawRecord }): void {
		const { record } = params
		const parent = this.openElements.at(-1)
		const element = createRecordElement({ context: this.context, record, parent: parent?.element })
		const text = record.value ? record.value.trim() : ''
		const hasChildren = record.children.length > 0
		const level = parent ? parent.level + 1 : 0
		const insideInline = parent ? parent.inline || parent.insideInline : false
		const opened: OpenElement = {
			element,
			qualifiedName: qualifiedNameOf(element),
			level,
			scope: this.rootScope,
			empty: !text && !hasChildren,
			inline: !this.indent || insideInline || isInline({ element, text, hasChildren }),
			insideInline,
		}

		if (parent) {
			this.refreshRootScope()
			const { text: startTag, scope } = serializeStartTag({
				element,
				scope: parent.scope,
				prefixes: this.prefixes,
			})
			opened.scope = scope
			if (!insideInline) this.newLine({ level })
			this.body.push(startTag, opened.empty ? '/>' : '>')
		} else {
			this.root = opened
		}
		this.openElements.push(opened)
		if (text) this.writeText({ text, owner: opened })
	}

	/** Close the element opened last. */
	closeElement(): void {
		const closed = this.openElements.pop()
		if (!closed || closed.empty) return
		if (!closed.inline) this.newLine({ level: closed.level })
		this.body.push(`</${closed.qualifiedName}>`)
	}

	/** The body written since the last call: what follows the root start tag. */
	take(): string {
		const chunk = this.body.join('')
		this.body = []
		return chunk
	}

	/** The XML declaration and the root start tag, complete once the root is closed. */
	head(): string {
		const root = this.root
		if (!root) return ''
		const { text: startTag } = serializeStartTag({
			element: root.element,
			scope: EMPTY_SCOPE,
			prefixes: { next: 1 },
		})
		const declaration = this.includeXmlDeclaration
			? XML_DECLARATION + (this.indent ? LINE_SEPARATOR : '')
			: ''
		return declaration + startTag + (root.empty ? '/>' : '>')
	}

	/** Bring the root's bindings up to date: the root gains declarations while its descendants are written. */
	private refreshRootScope(): void {
		const root = this.root
		if (!root) return
		const attributeCount = root.element.attributes.length
		if (attributeCount === this.rootAttributeCount) return
		this.rootAttributeCount = attributeCount
		const { scope, generated } = serializeStartTag({
			element: root.element,
			scope: EMPTY_SCOPE,
			prefixes: { next: 1 },
		})
		// a prefix the root declares for one of its attributes may be numbered otherwise once the root gains
		// declarations: its descendants never rely on it, they declare what they need
		this.rootBindings.clear()
		for (const [prefix, uri] of scope.bindings) {
			if (!generated.has(prefix)) this.rootBindings.set(prefix, uri)
		}
	}

	private writeText(params: { text: string; owner: OpenElement }): void {
		const { text, owner } = params
		if (!this.indent) {
			// a carriage return as a reference: an XML reader would turn it into a line feed
			this.body.push(escapeCompactTextValue(text))
			return
		}
		const escaped = escapeTextValue(text)
		if (!owner.inline) this.newLine({ level: owner.level + 1 })
		this.body.push(toLineSeparator(escaped))
	}

	private newLine(params: { level: number }): void {
		if (!this.indent) return
		const { level } = params
		this.newLines[level] ??= LINE_SEPARATOR + INDENTATION.repeat(level)
		this.body.push(this.newLines[level])
	}
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
