import { hasAttribute, hasAttributeNS, setAttribute, setAttributeNS } from './xml-element'
import { XML_NAMESPACE_URI } from './xml-writer.constants'

import { XMLNS_NAMESPACE_URI, XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { extractLocalName, resolveDefinition, resolveSchemaAttributeValue } from '@/utils'
import { ENGINE_XSD_PREFIX } from '@/utils/xsi-type.constants'

import type { RootNamespacesParams } from './root-namespaces.types'
import type { XmlAttribute, XmlElement } from './xml-element.types'
import type { AnyDialecteConfig, AnyRawRecord, Namespace } from '@/types'

/**
 * The namespaces of one written document, filled while it is written: one prefix per namespace (`''` = the default
 * namespace), one namespace per prefix, all declared on the written root (`declarations`). `bindings` is the scope in
 * force below the root. The one exception to one prefix per namespace: the dialecte's default namespace takes a second
 * prefix (`defaultAlias`) for what cannot be written unprefixed in it.
 */
export class RootNamespaces {
	/** The namespace each used prefix names. */
	readonly bindings = new Map<string, string>()
	private readonly config: AnyDialecteConfig
	private readonly documentRoot: AnyRawRecord | undefined
	/** The prefix each used namespace is written with. */
	private readonly prefixByUri = new Map<string, string>()
	/**
	 * The prefixes a namespace of the engine holds whether used or not (the dialecte's, `xsi`, `xs` for XSD, `xml`,
	 * `xmlns`): another namespace never takes one, so the choice does not depend on what is written first.
	 */
	private readonly reserved: ReadonlySet<string>
	/** Whether XSD is written `xs`: the dialecte does not use `xs` itself. */
	private readonly xsdTakesXs: boolean
	private nextGenerated = 1
	private rootElement: XmlElement | undefined
	/**
	 * Whether the written root binds the default namespace: not when the root itself is in no namespace, where each
	 * default-namespace element below declares `xmlns` on itself.
	 */
	private defaultOnRoot = true
	/** The prefix bound to the dialecte's default namespace, once something needs one. */
	private alias: string | undefined

	constructor(params: RootNamespacesParams) {
		const { config, documentRoot } = params
		this.config = config
		this.documentRoot = documentRoot
		const configured = (Object.values(config.namespaces) as Namespace[])
			.map((namespace) => namespace.prefix)
			.filter((prefix) => prefix !== '')
		this.xsdTakesXs = !configured.includes(ENGINE_XSD_PREFIX)
		const reserved = new Set([...configured, XSI_NAMESPACE.prefix, 'xml', 'xmlns'])
		if (this.xsdTakesXs) reserved.add(ENGINE_XSD_PREFIX)
		this.reserved = reserved
	}

	/**
	 * The prefix a namespace is written with (`''` = unprefixed), registered the first time the namespace is used;
	 * then, on the document root, the root attributes of that namespace the schema requires. The one place a prefix
	 * is chosen: the dialecte's prefix for its namespaces, `xsi` for XSI, `xs` for XSD (unless the dialecte uses `xs`),
	 * else the prefix the first record using the namespace was stored with when no other namespace holds it
	 * (`<prefix>2`, `<prefix>3`, … when one does), else a generated `ns<k>`. No namespace and the `xml` namespace are
	 * bound everywhere: nothing is registered.
	 */
	declareOnRoot(params: { uri: string; storedPrefix: string | undefined }): string {
		const { uri, storedPrefix } = params
		const known = this.prefixByUri.get(uri)
		if (known !== undefined) return known
		if (uri === '') return ''
		if (uri === XML_NAMESPACE_URI) return 'xml'

		const prefix = this.choosePrefix({ uri, storedPrefix })
		this.prefixByUri.set(uri, prefix)
		if (prefix !== '' || this.defaultOnRoot) this.bindings.set(prefix, uri)
		if (this.documentRoot && this.rootElement) {
			enforceRootAttributes({
				config: this.config,
				element: this.rootElement,
				namespace: { prefix, uri },
				rootRecord: this.documentRoot,
			})
		}
		return prefix
	}

	/**
	 * The prefix bound on the root to the dialecte's default namespace, for what cannot be written unprefixed in it:
	 * an attribute (an unprefixed attribute is in no namespace), a QName value where another default is in force. Made
	 * once per document: the prefix the first attribute needing it was stored with when no other namespace holds it, so
	 * its stored name stays the same across an export and a re-import; else a generated `ns<k>` (a value carries no
	 * stored prefix).
	 */
	defaultAlias(params: { storedPrefix: string | undefined }): string {
		const { storedPrefix } = params
		if (this.alias !== undefined) return this.alias
		const uri = this.config.namespaces.default.uri
		const alias = storedPrefix && this.isFree(storedPrefix) ? storedPrefix : this.generatePrefix()
		this.alias = alias
		this.bindings.set(alias, uri)
		return alias
	}

	/** The written root's own namespace, before anything is registered: a root in no namespace binds no default. */
	openRoot(params: { uri: string }): void {
		const { uri } = params
		this.defaultOnRoot = uri !== ''
	}

	/**
	 * The written root, once it holds its own attributes: on the document root, the root attributes of the namespaces
	 * registered so far; those registered later bring theirs as they come.
	 */
	attachRoot(params: { element: XmlElement }): void {
		const { element } = params
		this.rootElement = element
		const documentRoot = this.documentRoot
		if (!documentRoot) return
		for (const [uri, prefix] of this.prefixByUri) {
			enforceRootAttributes({
				config: this.config,
				element,
				namespace: { prefix, uri },
				rootRecord: documentRoot,
			})
		}
	}

	/**
	 * The declarations of the written root, in a fixed order: the default namespace (and its alias), XSI, the
	 * dialecte's namespaces in the config's order, then the others by namespace. Only the namespaces the written
	 * records use.
	 */
	declarations(): XmlAttribute[] {
		const { prefixByUri } = this
		const defaultUri = this.bindings.get('')
		const declarations: XmlAttribute[] = []
		if (defaultUri) declarations.push(declarationOf({ uri: defaultUri, prefix: '' }))
		if (this.alias !== undefined) {
			declarations.push(
				declarationOf({ uri: this.config.namespaces.default.uri, prefix: this.alias }),
			)
		}
		const ordered: string[] = []
		if (prefixByUri.has(XSI_NAMESPACE.uri)) ordered.push(XSI_NAMESPACE.uri)
		const configuredUris = new Set<string>()
		for (const namespace of Object.values(this.config.namespaces) as Namespace[]) {
			configuredUris.add(namespace.uri)
			// the default namespace is declared first, or not on the root at all
			if (namespace.uri === this.config.namespaces.default.uri) continue
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

	private choosePrefix(params: { uri: string; storedPrefix: string | undefined }): string {
		const { uri, storedPrefix } = params
		const { config } = this
		if (uri === config.namespaces.default.uri) return ''
		const configured = (Object.values(config.namespaces) as Namespace[]).find(
			(namespace) => namespace.uri === uri && namespace.prefix !== '',
		)
		if (configured) return configured.prefix
		if (uri === XSI_NAMESPACE.uri) return XSI_NAMESPACE.prefix
		if (uri === XSD_NAMESPACE_URI && this.xsdTakesXs) return ENGINE_XSD_PREFIX

		if (storedPrefix) {
			if (this.isFree(storedPrefix)) return storedPrefix
			for (let index = 2; ; index++) {
				const numbered = `${storedPrefix}${index}`
				if (this.isFree(numbered)) return numbered
			}
		}
		return this.generatePrefix()
	}

	/** The next free `ns<k>`. */
	private generatePrefix(): string {
		for (;;) {
			const generated = `ns${this.nextGenerated}`
			this.nextGenerated++
			if (this.isFree(generated)) return generated
		}
	}

	private isFree(prefix: string): boolean {
		return !this.reserved.has(prefix) && !this.bindings.has(prefix)
	}
}

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

/** The root attributes of a namespace the root's declaration requires or fixes, where the root does not hold them. */
function enforceRootAttributes(params: {
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
