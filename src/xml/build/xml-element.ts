import {
	ATTRIBUTE_ESCAPED,
	ATTRIBUTE_ESCAPED_ALL,
	COMPACT_TEXT_ESCAPED,
	COMPACT_TEXT_ESCAPED_ALL,
	ESCAPES,
	NO_PREFIXES,
	TEXT_ESCAPED,
	TEXT_ESCAPED_ALL,
	XML_NAMESPACE_URI,
} from './xml-writer.constants'

import { XMLNS_NAMESPACE_URI } from '@/helpers/constant'

import type {
	GeneratedPrefixes,
	NamespaceScope,
	XmlAttribute,
	XmlElement,
} from './xml-element.types'

// ── Building ─────────────────────────────────────────────────────────────────

/** An element named as `createElementNS` (with a namespace) or `createElement` (without) names it. */
export function createXmlElement(params: {
	namespaceURI: string | null
	qualifiedName: string
	parent: XmlElement | undefined
}): XmlElement {
	const { namespaceURI, qualifiedName, parent } = params
	if (namespaceURI === null) {
		return { namespaceURI, prefix: null, localName: qualifiedName, attributes: [], parent }
	}
	const { prefix, localName } = splitQualifiedName(qualifiedName)
	return { namespaceURI, prefix, localName, attributes: [], parent }
}

/** `setAttribute`: the attribute of that qualified name takes the value, or a new one in no namespace is added last. */
export function setAttribute(params: {
	element: XmlElement
	qualifiedName: string
	value: string
}): void {
	const { element, qualifiedName, value } = params
	const existing = element.attributes.find(
		(attribute) => qualifiedNameOf(attribute) === qualifiedName,
	)
	if (existing) {
		existing.value = value
		return
	}
	element.attributes.push({ namespaceURI: null, prefix: null, localName: qualifiedName, value })
}

/**
 * `setAttributeNS`: the attribute of that namespace and local name takes the value (keeping its prefix), or a new one
 * is added last.
 */
export function setAttributeNS(params: {
	element: XmlElement
	namespaceURI: string
	qualifiedName: string
	value: string
}): void {
	const { element, namespaceURI, qualifiedName, value } = params
	const { prefix, localName } = splitQualifiedName(qualifiedName)
	const existing = findAttributeNS({ element, namespaceURI, localName })
	if (existing) {
		existing.value = value
		return
	}
	element.attributes.push({ namespaceURI, prefix, localName, value })
}

/** `hasAttribute`: an attribute of that qualified name, whatever its namespace. */
export function hasAttribute(params: { element: XmlElement; qualifiedName: string }): boolean {
	const { element, qualifiedName } = params
	return element.attributes.some((attribute) => qualifiedNameOf(attribute) === qualifiedName)
}

/** `getAttributeNS`: the value of the attribute of that namespace and local name, `null` when absent. */
export function getAttributeNS(params: {
	element: XmlElement
	namespaceURI: string
	localName: string
}): string | null {
	return findAttributeNS(params)?.value ?? null
}

/** `hasAttributeNS`: an attribute of that namespace and local name. */
export function hasAttributeNS(params: {
	element: XmlElement
	namespaceURI: string
	localName: string
}): boolean {
	return findAttributeNS(params) !== undefined
}

// ── Lookups (DOM "locate a namespace" and "locate a namespace prefix") ─────────

/** The namespace a prefix (`null` = the default) names where the element stands: its own name, its declarations, its ancestors'. */
export function lookupNamespaceURI(params: {
	element: XmlElement
	prefix: string | null
}): string | null {
	const { prefix } = params
	for (let element: XmlElement | undefined = params.element; element; element = element.parent) {
		if (element.namespaceURI !== null && element.prefix === prefix) return element.namespaceURI
		const declaration = element.attributes.find((attribute) =>
			isDeclarationOf({ attribute, prefix }),
		)
		if (declaration) return declaration.value || null
	}
	return null
}

/** A prefix bound to the namespace where the element stands: its own name's, its declarations', its ancestors'. */
export function lookupPrefix(params: { element: XmlElement; namespaceURI: string }): string | null {
	const { namespaceURI } = params
	if (!namespaceURI) return null
	for (let element: XmlElement | undefined = params.element; element; element = element.parent) {
		if (element.namespaceURI === namespaceURI && element.prefix !== null) return element.prefix
		const declaration = element.attributes.find(
			(attribute) =>
				attribute.namespaceURI === XMLNS_NAMESPACE_URI &&
				attribute.prefix === 'xmlns' &&
				attribute.value === namespaceURI,
		)
		if (declaration) return declaration.localName
	}
	return null
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * The start tag `XMLSerializer` writes for the element where `scope` is in force, without its closing `>` or `/>`,
 * and the scope its children stand in. The element's own declarations count before anything is written; a namespace
 * its name or an attribute needs and that is not bound there is declared where it is needed: right after the name for
 * the element's, right before the attribute for an attribute's.
 */
export function serializeStartTag(params: {
	element: XmlElement
	scope: NamespaceScope
	prefixes: GeneratedPrefixes
}): {
	text: string
	scope: NamespaceScope
	/** The prefixes declared here for an attribute only (not by the element's own declarations or name) */
	generated: ReadonlySet<string>
} {
	const { element, prefixes } = params
	let generated: Set<string> | undefined
	const parent = params.scope
	// the element's own bindings, made only when it binds something (most elements bind nothing)
	let own: Map<string, string> | undefined
	for (const attribute of element.attributes) {
		const declared = declaredPrefixOf(attribute)
		if (declared === undefined) continue
		if (boundIn({ parent, own, prefix: declared }) === attribute.value) continue
		own ??= new Map()
		own.set(declared, attribute.value)
	}

	let text = `<${qualifiedNameOf(element)}`
	const elementPrefix = element.prefix ?? ''
	const elementNamespace = element.namespaceURI ?? ''
	const defaultNamespace = boundIn({ parent, own, prefix: '' })
	if (element.namespaceURI !== null || defaultNamespace) {
		if ((boundIn({ parent, own, prefix: elementPrefix }) ?? '') !== elementNamespace) {
			text += elementPrefix
				? ` xmlns:${elementPrefix}="${escapeAttributeValue(elementNamespace)}"`
				: ` xmlns="${escapeAttributeValue(elementNamespace)}"`
			own ??= new Map()
			own.set(elementPrefix, elementNamespace)
		}
	}

	for (const attribute of element.attributes) {
		const { namespaceURI } = attribute
		const isNamespaced =
			namespaceURI !== null &&
			namespaceURI !== XMLNS_NAMESPACE_URI &&
			namespaceURI !== XML_NAMESPACE_URI &&
			attribute.prefix !== null
		if (!isNamespaced) {
			text += ` ${qualifiedNameOf(attribute)}="${escapeAttributeValue(attribute.value)}"`
			continue
		}
		const { prefix, declare } = attributePrefixOf({ attribute, parent, own, prefixes })
		if (declare) {
			text += ` xmlns:${prefix}="${escapeAttributeValue(namespaceURI)}"`
			own ??= new Map()
			own.set(prefix, namespaceURI)
			generated ??= new Set()
			generated.add(prefix)
		}
		text += ` ${prefix}:${attribute.localName}="${escapeAttributeValue(attribute.value)}"`
	}
	return {
		text,
		scope: own ? { bindings: own, parent } : parent,
		generated: generated ?? NO_PREFIXES,
	}
}

/**
 * The prefix a namespaced attribute is written with, as `XMLSerializer` picks it: its own when bound to its
 * namespace; else a prefix bound to that namespace where the element stands; else its own, declared, when bound
 * to nothing; else a generated `ns<k>`, declared. A prefix bound to another namespace is never re-bound.
 */
function attributePrefixOf(params: {
	attribute: XmlAttribute
	parent: NamespaceScope
	own: ReadonlyMap<string, string> | undefined
	prefixes: GeneratedPrefixes
}): { prefix: string; declare: boolean } {
	const { attribute, parent, own, prefixes } = params
	const namespaceURI = attribute.namespaceURI!
	const prefix = attribute.prefix!
	const bound = boundIn({ parent, own, prefix })
	if (bound === namespaceURI) return { prefix, declare: false }
	const other = prefixBoundTo({ parent, own, namespaceURI })
	if (other !== undefined) return { prefix: other, declare: false }
	if (bound === undefined) return { prefix, declare: true }
	for (;;) {
		const generated = `ns${prefixes.next}`
		prefixes.next++
		if (boundIn({ parent, own, prefix: generated }) === undefined) {
			return { prefix: generated, declare: true }
		}
	}
}

/** A non-empty prefix bound to the namespace where the element stands, the closest binding first. */
function prefixBoundTo(params: {
	parent: NamespaceScope
	own: ReadonlyMap<string, string> | undefined
	namespaceURI: string
}): string | undefined {
	const { parent, own, namespaceURI } = params
	const shadowed = new Set<string>()
	const levels = [own, ...scopeChainOf(parent)]
	for (const bindings of levels) {
		if (!bindings) continue
		for (const [prefix, uri] of [...bindings].reverse()) {
			if (shadowed.has(prefix)) continue
			shadowed.add(prefix)
			if (prefix && uri === namespaceURI) return prefix
		}
	}
	return undefined
}

function scopeChainOf(scope: NamespaceScope | undefined): ReadonlyMap<string, string>[] {
	const chain: ReadonlyMap<string, string>[] = []
	for (let current = scope; current; current = current.parent) chain.push(current.bindings)
	return chain
}

/** An attribute value as `XMLSerializer` writes it. */
function escapeAttributeValue(value: string): string {
	if (!ATTRIBUTE_ESCAPED.test(value)) return value
	return value.replace(ATTRIBUTE_ESCAPED_ALL, escapeCharacter)
}

/**
 * A text value of the compact layout: as `XMLSerializer` writes it, and a carriage return as `&#13;`, so a reader
 * of the file gets the value back (XML reads a raw carriage return as a line feed).
 */
export function escapeCompactTextValue(value: string): string {
	if (!COMPACT_TEXT_ESCAPED.test(value)) return value
	return value.replace(COMPACT_TEXT_ESCAPED_ALL, escapeCharacter)
}

/** A text value as `XMLSerializer` writes it. */
export function escapeTextValue(value: string): string {
	if (!TEXT_ESCAPED.test(value)) return value
	return value.replace(TEXT_ESCAPED_ALL, escapeCharacter)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeCharacter(character: string): string {
	return ESCAPES[character]!
}

function splitQualifiedName(qualifiedName: string): { prefix: string | null; localName: string } {
	const colon = qualifiedName.indexOf(':')
	if (colon === -1) return { prefix: null, localName: qualifiedName }
	return { prefix: qualifiedName.slice(0, colon), localName: qualifiedName.slice(colon + 1) }
}

/** The name as written: `prefix:localName`, or the local name alone. */
export function qualifiedNameOf(node: { prefix: string | null; localName: string }): string {
	return node.prefix ? `${node.prefix}:${node.localName}` : node.localName
}

function findAttributeNS(params: {
	element: XmlElement
	namespaceURI: string
	localName: string
}): XmlAttribute | undefined {
	const { element, namespaceURI, localName } = params
	return element.attributes.find(
		(attribute) => attribute.namespaceURI === namespaceURI && attribute.localName === localName,
	)
}

/** Whether the attribute declares the prefix (`null` = the default namespace) for `lookupNamespaceURI`. */
function isDeclarationOf(params: { attribute: XmlAttribute; prefix: string | null }): boolean {
	const { attribute, prefix } = params
	if (attribute.namespaceURI !== XMLNS_NAMESPACE_URI) return false
	if (prefix === null) return attribute.prefix === null && attribute.localName === 'xmlns'
	return attribute.prefix === 'xmlns' && attribute.localName === prefix
}

/**
 * The prefix an attribute declares for the serializer (`''` = the default namespace): an `xmlns` / `xmlns:p` in the
 * xmlns namespace, or an `xmlns` set without a namespace; `undefined` for any other attribute.
 */
function declaredPrefixOf(attribute: XmlAttribute): string | undefined {
	if (attribute.namespaceURI === XMLNS_NAMESPACE_URI) {
		return attribute.prefix === 'xmlns' ? attribute.localName : ''
	}
	if (attribute.namespaceURI === null && attribute.localName === 'xmlns') return ''
	return undefined
}

/** The uri a prefix is bound to in a scope, `undefined` when bound nowhere. */
function boundInScope(params: {
	scope: NamespaceScope | undefined
	prefix: string
}): string | undefined {
	const { prefix } = params
	for (let scope = params.scope; scope; scope = scope.parent) {
		const uri = scope.bindings.get(prefix)
		if (uri !== undefined) return uri
	}
	return undefined
}

/** The uri a prefix is bound to: by the element itself so far, else where it stands. */
function boundIn(params: {
	parent: NamespaceScope
	own: ReadonlyMap<string, string> | undefined
	prefix: string
}): string | undefined {
	const { parent, own, prefix } = params
	return own?.get(prefix) ?? boundInScope({ scope: parent, prefix })
}
