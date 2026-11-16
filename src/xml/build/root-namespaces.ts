import { hasAttribute, hasAttributeNS, setAttribute, setAttributeNS } from './xml-element'
import { XML_NAMESPACE_URI } from './xml-writer.constants'

import { XMLNS_NAMESPACE_URI, XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { extractLocalName, resolveDefinition, resolveSchemaAttributeValue } from '@/utils'
import { ENGINE_XSD_PREFIX } from '@/utils/xsi-type.constants'

import type { NamespaceRegistration, NamespaceTable } from './root-namespaces.types'
import type { XmlAttribute, XmlElement } from './xml-element.types'
import type { AnyDialecteConfig, AnyRawRecord, Namespace } from '@/types'

/**
 * The namespaces of a document about to be written, none used yet. `rootUri` is the written root's own namespace: a
 * root in no namespace binds no default, each default-namespace element below declares `xmlns` on itself.
 */
export function emptyNamespaceTable(params: {
	config: AnyDialecteConfig
	rootUri: string
}): NamespaceTable {
	const { config, rootUri } = params
	const configured = (Object.values(config.namespaces) as Namespace[])
		.map((namespace) => namespace.prefix)
		.filter((prefix) => prefix !== '')
	const xsdTakesXs = !configured.includes(ENGINE_XSD_PREFIX)
	const reserved = new Set([...configured, XSI_NAMESPACE.prefix, 'xml', 'xmlns'])
	if (xsdTakesXs) reserved.add(ENGINE_XSD_PREFIX)
	return {
		bindings: new Map(),
		prefixByUri: new Map(),
		reserved,
		xsdTakesXs,
		nextGenerated: 1,
		defaultOnRoot: rootUri !== '',
		alias: undefined,
	}
}

/**
 * The prefix a namespace is written with (`''` = unprefixed), registered the first time the namespace is used: a
 * namespace already registered answers the same table. The one place a prefix is chosen: the dialecte's prefix for
 * its namespaces, `xsi` for XSI, `xs` for XSD (unless the dialecte uses `xs`), else the prefix the first record using
 * the namespace was stored with when no other namespace holds it (`<prefix>2`, `<prefix>3`, … when one does), else a
 * generated `ns<k>`. No namespace and the `xml` namespace are bound everywhere: nothing is registered.
 */
export function registerNamespace(params: {
	table: NamespaceTable
	config: AnyDialecteConfig
	uri: string
	storedPrefix: string | undefined
}): NamespaceRegistration {
	const { table, config, uri, storedPrefix } = params
	const known = table.prefixByUri.get(uri)
	if (known !== undefined) return { table, prefix: known }
	if (uri === '') return { table, prefix: '' }
	if (uri === XML_NAMESPACE_URI) return { table, prefix: 'xml' }

	const { prefix, nextGenerated } = choosePrefix({ table, config, uri, storedPrefix })
	const prefixByUri = new Map(table.prefixByUri).set(uri, prefix)
	const bindings =
		prefix !== '' || table.defaultOnRoot ? new Map(table.bindings).set(prefix, uri) : table.bindings
	return { table: { ...table, prefixByUri, bindings, nextGenerated }, prefix }
}

/**
 * The prefix bound on the root to the dialecte's default namespace, for what cannot be written unprefixed in it: an
 * attribute (an unprefixed attribute is in no namespace), a QName value where another default is in force. Made once
 * per document: the prefix the first attribute needing it was stored with when no other namespace holds it, so its
 * stored name stays the same across an export and a re-import; else a generated `ns<k>` (a value carries no stored
 * prefix).
 */
export function registerDefaultAlias(params: {
	table: NamespaceTable
	config: AnyDialecteConfig
	storedPrefix: string | undefined
}): NamespaceRegistration {
	const { table, config, storedPrefix } = params
	if (table.alias !== undefined) return { table, prefix: table.alias }
	const { prefix, nextGenerated } =
		storedPrefix && isFree({ table, prefix: storedPrefix })
			? { prefix: storedPrefix, nextGenerated: table.nextGenerated }
			: generatePrefix({ table })
	const bindings = new Map(table.bindings).set(prefix, config.namespaces.default.uri)
	return { table: { ...table, alias: prefix, bindings, nextGenerated }, prefix }
}

/**
 * The declarations of the written root, in a fixed order: the default namespace (and its alias), XSI, the dialecte's
 * namespaces in the config's order, then the others by namespace. Only the namespaces the written records use.
 */
export function rootDeclarations(params: {
	table: NamespaceTable
	config: AnyDialecteConfig
}): XmlAttribute[] {
	const { table, config } = params
	const { prefixByUri } = table
	const defaultUri = table.bindings.get('')
	const declarations: XmlAttribute[] = []
	if (defaultUri) declarations.push(declarationOf({ uri: defaultUri, prefix: '' }))
	if (table.alias !== undefined) {
		declarations.push(declarationOf({ uri: config.namespaces.default.uri, prefix: table.alias }))
	}
	const ordered: string[] = []
	if (prefixByUri.has(XSI_NAMESPACE.uri)) ordered.push(XSI_NAMESPACE.uri)
	const configuredUris = new Set<string>()
	for (const namespace of Object.values(config.namespaces) as Namespace[]) {
		configuredUris.add(namespace.uri)
		// the default namespace is declared first, or not on the root at all
		if (namespace.uri === config.namespaces.default.uri) continue
		if (namespace.uri === XSI_NAMESPACE.uri) continue
		if (prefixByUri.has(namespace.uri) && !ordered.includes(namespace.uri)) {
			ordered.push(namespace.uri)
		}
	}
	const others = [...prefixByUri.keys()]
		.filter((uri) => uri !== defaultUri && uri !== XSI_NAMESPACE.uri && !configuredUris.has(uri))
		.sort(compareUris)
	for (const uri of [...ordered, ...others]) {
		declarations.push(declarationOf({ uri, prefix: prefixByUri.get(uri) ?? '' }))
	}
	return declarations
}

/**
 * The root attributes the root's declaration requires or fixes in each namespace the written records use, where the
 * written root does not hold them: namespace by namespace in the order they were registered, to follow the root's own
 * attributes. Computed once the root is complete; a fragment (no document root) gets none.
 */
export function requiredRootAttributes(params: {
	table: NamespaceTable
	config: AnyDialecteConfig
	documentRoot: AnyRawRecord | undefined
	element: XmlElement
}): XmlAttribute[] {
	const { table, config, documentRoot, element } = params
	if (!documentRoot || table.prefixByUri.size === 0) return []
	// a working copy: the attributes added for one namespace are seen by the next
	const completed: XmlElement = { ...element, attributes: [...element.attributes] }
	for (const [uri, prefix] of table.prefixByUri) {
		addRequiredRootAttributes({
			config,
			element: completed,
			namespace: { prefix, uri },
			rootRecord: documentRoot,
		})
	}
	return completed.attributes.slice(element.attributes.length)
}

// ── Prefix choice ────────────────────────────────────────────────────────────

function choosePrefix(params: {
	table: NamespaceTable
	config: AnyDialecteConfig
	uri: string
	storedPrefix: string | undefined
}): { prefix: string; nextGenerated: number } {
	const { table, config, uri, storedPrefix } = params
	const kept = table.nextGenerated
	if (uri === config.namespaces.default.uri) return { prefix: '', nextGenerated: kept }
	const configured = (Object.values(config.namespaces) as Namespace[]).find(
		(namespace) => namespace.uri === uri && namespace.prefix !== '',
	)
	if (configured) return { prefix: configured.prefix, nextGenerated: kept }
	if (uri === XSI_NAMESPACE.uri) return { prefix: XSI_NAMESPACE.prefix, nextGenerated: kept }
	if (uri === XSD_NAMESPACE_URI && table.xsdTakesXs) {
		return { prefix: ENGINE_XSD_PREFIX, nextGenerated: kept }
	}
	if (storedPrefix) return { prefix: freePrefixFrom({ table, storedPrefix }), nextGenerated: kept }
	return generatePrefix({ table })
}

/** The stored prefix when no other namespace holds it, else the first free `<prefix>2`, `<prefix>3`, … */
function freePrefixFrom(params: { table: NamespaceTable; storedPrefix: string }): string {
	const { table, storedPrefix } = params
	if (isFree({ table, prefix: storedPrefix })) return storedPrefix
	for (let index = 2; ; index++) {
		const numbered = `${storedPrefix}${index}`
		if (isFree({ table, prefix: numbered })) return numbered
	}
}

/** The next free `ns<k>`, and the number the one after it tries first. */
function generatePrefix(params: { table: NamespaceTable }): {
	prefix: string
	nextGenerated: number
} {
	const { table } = params
	for (let number = table.nextGenerated; ; number++) {
		const generated = `ns${number}`
		if (isFree({ table, prefix: generated })) {
			return { prefix: generated, nextGenerated: number + 1 }
		}
	}
}

function isFree(params: { table: NamespaceTable; prefix: string }): boolean {
	const { table, prefix } = params
	return !table.reserved.has(prefix) && !table.bindings.has(prefix)
}

// ── Root ─────────────────────────────────────────────────────────────────────

/** The `xmlns` / `xmlns:p` attribute that binds the prefix to the namespace. */
function declarationOf(params: { uri: string; prefix: string }): XmlAttribute {
	const { uri, prefix } = params
	return prefix
		? { namespaceURI: XMLNS_NAMESPACE_URI, prefix: 'xmlns', localName: prefix, value: uri }
		: { namespaceURI: XMLNS_NAMESPACE_URI, prefix: null, localName: 'xmlns', value: uri }
}

/** Namespaces by their code units: the same order on every platform and locale. */
function compareUris(left: string, right: string): number {
	if (left === right) return 0
	return left < right ? -1 : 1
}

/**
 * The root attributes of a namespace the root's declaration requires or fixes, where the root does not hold them,
 * added to the working copy `requiredRootAttributes` made.
 */
function addRequiredRootAttributes(params: {
	config: AnyDialecteConfig
	element: XmlElement
	namespace: Namespace
	rootRecord: AnyRawRecord
}): void {
	const { config, element, namespace, rootRecord } = params
	// the root as declared: the global declaration of its namespace, and the type it names with xsi:type
	const details =
		resolveDefinition({ dialecteConfig: config, record: rootRecord })?.attributes.details ?? {}
	const isDefaultNamespace = namespace.uri === config.namespaces.default.uri

	for (const [attributeName, attribute] of Object.entries(details)) {
		const value = resolveSchemaAttributeValue({
			dialecteConfig: config,
			record: rootRecord,
			attributeName,
			defaults: 'required',
		})
		if (value === undefined) continue
		const inNamespace = isDefaultNamespace
			? !attribute.namespace
			: attribute.namespace?.prefix === namespace.prefix &&
				attribute.namespace?.uri === namespace.uri
		if (!inNamespace) continue

		const localName = extractLocalName(attributeName)
		const exists = attribute.namespace
			? hasAttributeNS({ element, namespaceURI: attribute.namespace.uri, localName })
			: hasAttribute({ element, qualifiedName: localName })
		if (exists) continue

		if (attribute.namespace) {
			setAttributeNS({
				element,
				namespaceURI: attribute.namespace.uri,
				qualifiedName: `${attribute.namespace.prefix}:${localName}`,
				value,
			})
		} else {
			setAttribute({ element, qualifiedName: localName, value })
		}
	}
}
