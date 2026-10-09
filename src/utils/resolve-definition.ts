import { resolveNamespaceByPrefix } from './namespaces'

import { XMLNS_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'

import type { ResolvableRecord } from './resolve-definition.types'
import type {
	AnyDialecteConfig,
	ContentDefinition,
	DeclarationDefinition,
	ElementDefinition,
	ResolvedDefinition,
} from '@/types'

export type { ResolvableRecord } from './resolve-definition.types'

/** What resolving reads of a dialecte: its definition, its types and its namespaces. */
type DefinitionConfig = Pick<AnyDialecteConfig, 'definition' | 'types' | 'namespaces'>

/**
 * The definition that applies to a record - the one rule every reader of the definition follows.
 * A tag declared one way is its tag level. A tag declared several ways takes the declaration its
 * parent holds in the record's namespace (the only namespace held there, for a record that has none
 * yet); a parent whose wildcard admits it, or no parent, gives the global declaration of that
 * namespace; a parent leaving it to the particle the record matches gives the tag level, the union,
 * lenient where the declarations differ. The parent is read at its tag level unless the caller gives
 * its resolved definition (`parentDefinition`, a top-down walk does). Then the record's `xsi:type`,
 * when its declaration admits the type, gives what the type lets it hold.
 * It takes a record, whose `parent` is always known (`null` for the root); a ref carries no parent,
 * so a caller holding one uses `query.getDefinition(ref)`, which fetches the record first.
 */
export function resolveDefinition(params: {
	dialecteConfig: DefinitionConfig
	record: ResolvableRecord
	parentDefinition?: DeclarationDefinition
}): ResolvedDefinition | undefined {
	const { dialecteConfig, record, parentDefinition } = params
	const tagLevel = dialecteConfig.definition[record.tagName]
	if (tagLevel === undefined) return undefined

	const declaration = declarationOf({ dialecteConfig, record, tagLevel, parentDefinition })
	const typeName = xsiTypeOf({ dialecteConfig, record })
	// the lenient tag level, where the parent leaves the declaration open: a type one of its declarations admits
	const admitting =
		declaration === tagLevel
			? Object.values(tagLevel.declarations ?? {}).concat(tagLevel)
			: [declaration]
	const type =
		typeName !== undefined && admitting.some((candidate) => candidate.variants?.includes(typeName))
			? dialecteConfig.types[typeName]
			: undefined
	// a tag declared one way, read as declared: the tag level itself
	if (declaration === tagLevel && type === undefined && tagLevel.declarations === undefined)
		return tagLevel
	return resolved({ tagLevel, declaration, type })
}

/** The declaration of the tag that applies under the record's parent; the tag level when none is decided. */
function declarationOf(params: {
	dialecteConfig: DefinitionConfig
	record: ResolvableRecord
	tagLevel: ElementDefinition
	parentDefinition?: DeclarationDefinition
}): DeclarationDefinition {
	const { dialecteConfig, record, tagLevel, parentDefinition } = params
	const declarations = tagLevel.declarations
	if (declarations === undefined) return tagLevel

	const parent =
		parentDefinition ??
		(record.parent ? dialecteConfig.definition[record.parent.tagName] : undefined)
	const held = parent?.children.details[record.tagName]?.declarations
	if (held !== undefined) {
		const namespaces = Object.keys(held)
		const uri = record.namespace?.uri ?? (namespaces.length === 1 ? namespaces[0] : undefined)
		const ids = uri === undefined ? undefined : held[uri]
		if (ids !== undefined) return ids.length === 1 ? (declarations[ids[0]] ?? tagLevel) : tagLevel
	}
	// no particle of the parent names it: admitted by a wildcard, or a root - its namespace's global declaration
	const isRootOrWildcard = parent === undefined || parent.children.any === true
	const uri = record.namespace?.uri
	if (!isRootOrWildcard || uri === undefined) return tagLevel
	return (
		Object.values(declarations).find(
			(declaration) => declaration.global && declaration.namespace.uri === uri,
		) ?? tagLevel
	)
}

/**
 * The Clark name of the type the record names with xsi:type, its prefix bound on the record itself or by the dialecte.
 * A prefix the document binds on an ancestor only, to another name than the dialecte's, is not seen: the record does
 * not carry the namespaces in scope.
 */
function xsiTypeOf(params: {
	dialecteConfig: DefinitionConfig
	record: ResolvableRecord
}): string | undefined {
	const { dialecteConfig, record } = params
	const attribute = record.attributes.find(
		(candidate) =>
			candidate.namespace?.uri === XSI_NAMESPACE.uri && candidate.name.split(':').at(-1) === 'type',
	)
	if (attribute === undefined) return undefined
	const value = attribute.value.trim()
	const colon = value.indexOf(':')
	const prefix = colon === -1 ? '' : value.slice(0, colon)
	const local = colon === -1 ? value : value.slice(colon + 1)
	// as parsed (`q` in the xmlns namespace, `xmlns` for the default) or as created (`xmlns:q`)
	const declared = record.attributes.find((candidate) =>
		prefix
			? candidate.name === `xmlns:${prefix}` ||
				(candidate.namespace?.uri === XMLNS_NAMESPACE_URI && candidate.name === prefix)
			: candidate.name === 'xmlns',
	)
	const uri =
		declared?.value ??
		(prefix
			? resolveNamespaceByPrefix(dialecteConfig, prefix)?.uri
			: dialecteConfig.namespaces.default.uri)
	if (uri === undefined) return undefined
	return uri ? `{${uri}}${local}` : local
}

/**
 * The tag with one declaration, and what a type it names lets it hold: its attributes (the element's identity
 * fields kept), children, content model and text. Definitions are immutable: built once per pair.
 */
function resolved(params: {
	tagLevel: ElementDefinition
	declaration: DeclarationDefinition
	type: ContentDefinition | undefined
}): ResolvedDefinition {
	const { tagLevel, declaration, type } = params
	const byType =
		resolvedByDeclaration.get(declaration) ??
		new Map<ContentDefinition | undefined, ResolvedDefinition>()
	resolvedByDeclaration.set(declaration, byType)
	const cached = byType.get(type)
	if (cached?.tag === tagLevel.tag && cached.parents === tagLevel.parents) return cached

	// the declaration's own fields only, never a mix with the union: the tag level gives the tag and its parents
	const {
		declarations: _declarations,
		abstractType: _abstractType,
		...ofDeclaration
	} = declaration as ElementDefinition
	const own = { ...ofDeclaration, tag: tagLevel.tag, parents: tagLevel.parents }
	const definition: ResolvedDefinition =
		type === undefined
			? { ...own, ...(declaration.abstractType ? { abstractType: true } : {}) }
			: {
					...own,
					attributes:
						declaration.attributes.identityFields === undefined
							? type.attributes
							: { ...type.attributes, identityFields: declaration.attributes.identityFields },
					children: type.children,
					contentModel: type.contentModel,
					textContent: type.textContent,
				}
	if (definition.contentModel === undefined)
		delete (definition as { contentModel?: unknown }).contentModel
	if (definition.textContent === undefined)
		delete (definition as { textContent?: unknown }).textContent
	byType.set(type, definition)
	return definition
}

const resolvedByDeclaration = new WeakMap<
	DeclarationDefinition,
	Map<ContentDefinition | undefined, ResolvedDefinition>
>()
