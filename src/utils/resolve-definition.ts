import type { AnyDialecteConfig, AnyRawRecord, ElementDefinition } from '@/types'

/**
 * The definition of an element in its context. When the schema declares the tag differently under
 * the record's parent, what the element holds there - attributes, children, content model, text -
 * comes from that parent's edge, all of it; the rest (tag, namespace, parents, constraints) is the
 * tag-level definition's. Otherwise the tag-level definition itself, the union of its
 * declarations. The one rule every reader of the definition follows. It takes a record, whose
 * `parent` is always known (`null` for the root); a ref carries no parent, so a caller holding one
 * uses `query.getDefinition(ref)`, which fetches the record first.
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
	if (edge?.attributes === undefined || edge.children === undefined) return tagLevel

	// only for the few elements declared differently under this parent
	return {
		tag: tagLevel.tag,
		namespace: tagLevel.namespace,
		documentation: tagLevel.documentation,
		parents: tagLevel.parents,
		constraints: tagLevel.constraints,
		nillable: edge.nillable,
		attributes: edge.attributes,
		children: edge.children,
		contentModel: edge.contentModel,
		textContent: edge.textContent,
	}
}
