import type { DeclaredEdge } from './resolve-definition.types'
import type { AnyDialecteConfig, AnyRawRecord, ChildDefinition, ElementDefinition } from '@/types'

/**
 * The definition of an element in its context. When the schema declares the tag differently under
 * the record's parent, what the element holds there - attributes, children, content model, text -
 * comes from that parent's edge, all of it; the identity constraints declared under that parent
 * come from the edge too (an edge without constraints falls back to the tag level's: right for an
 * element a wildcard admits, which keeps its global declaration's). The rest (tag, namespace,
 * parents) is the tag-level definition's.
 * Otherwise the tag-level definition itself, the union of its declarations. The one rule every
 * reader of the definition follows. It takes a record, whose `parent` is always known (`null` for
 * the root); a ref carries no parent, so a caller holding one uses `query.getDefinition(ref)`,
 * which fetches the record first.
 */
export function resolveDefinition(params: {
	dialecteConfig: AnyDialecteConfig
	record: Pick<AnyRawRecord, 'tagName' | 'parent'>
}): ElementDefinition | undefined {
	const { dialecteConfig, record } = params
	const tagLevel = dialecteConfig.definition[record.tagName]
	if (tagLevel === undefined) return undefined
	const parentTagName = record.parent?.tagName
	if (!parentTagName) return tagLevel

	const edge = dialecteConfig.definition[parentTagName]?.children.details[record.tagName]
	if (edge === undefined) return tagLevel
	const declaredOnEdge = isDeclaredOnEdge(edge)
	if (!declaredOnEdge && edge.constraints === undefined) return tagLevel

	// only for the elements declared differently, or constrained differently, under this parent:
	// built once per edge
	const cached = resolvedByEdge.get(edge)
	if (cached?.tagLevel === tagLevel) return cached.definition
	const definition = declaredOnEdge
		? mergeDeclaration({ tagLevel, edge })
		: { ...tagLevel, constraints: edge.constraints }
	resolvedByEdge.set(edge, { tagLevel, definition })
	return definition
}

/** Definitions are immutable: the merge of a tag level and one of its edges never changes. */
const resolvedByEdge = new WeakMap<
	ChildDefinition,
	{ tagLevel: ElementDefinition; definition: ElementDefinition }
>()

/** The edge carries the element as declared under this parent: all of it, never a mix. */
function isDeclaredOnEdge(edge: ChildDefinition): edge is DeclaredEdge {
	return edge.attributes !== undefined && edge.children !== undefined
}

/** The element as declared under this parent: what it holds from the edge, the rest from the tag level. */
function mergeDeclaration(params: {
	tagLevel: ElementDefinition
	edge: DeclaredEdge
}): ElementDefinition {
	const { tagLevel, edge } = params
	return {
		tag: tagLevel.tag,
		namespace: tagLevel.namespace,
		documentation: tagLevel.documentation,
		parents: tagLevel.parents,
		constraints: edge.constraints ?? tagLevel.constraints,
		nillable: edge.nillable,
		attributes: edge.attributes,
		children: edge.children,
		contentModel: edge.contentModel,
		textContent: edge.textContent,
	}
}
