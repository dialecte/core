import { NO_ATTRIBUTES } from './qname-typed.constants'

import type { QualifiedNamesOfTag } from './qname-typed.types'
import type { AnyDialecteConfig, ContentDefinition, DataType } from '@/types'

/**
 * Whether a datatype reads qualified names, whose meaning depends on the namespaces in scope: xs:QName or
 * NOTATION (a type derived from one is generated as that built-in), a list of one, or a union holding one.
 *
 * @internal which values core stores resolved (import, writes, export, filters)
 */
export function readsQualifiedNames(type: DataType | undefined): boolean {
	if (type === undefined) return false
	if ('builtin' in type) return type.builtin === 'QName' || type.builtin === 'NOTATION'
	if ('list' in type) return readsQualifiedNames(type.list)
	return type.union.some(readsQualifiedNames)
}

/**
 * Whether an element of the tag may hold a QName-typed value - an attribute or its text - in any of its declarations
 * or the types it may name with xsi:type. Read once per definition and types: an import asks it for every element.
 *
 * @internal which records the import and export resolve QName values on
 */
export function mayHoldQualifiedNames(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'types'>
	tagName: string
}): boolean {
	const { dialecteConfig, tagName } = params
	return qualifiedNameTagsOf({ dialecteConfig }).has(tagName)
}

/**
 * The attributes an element of the tag may hold as QName-typed, by stored name (`ext:cEE_1`), in any of its
 * declarations or the types it may name with xsi:type. Read once per definition and types, as `mayHoldQualifiedNames`.
 *
 * @internal which filter values a query reads as qualified names, before it resolves a record's definition
 */
export function qualifiedNameAttributesOf(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'types'>
	tagName: string
}): ReadonlySet<string> {
	const { dialecteConfig, tagName } = params
	return qualifiedNameTagsOf({ dialecteConfig }).get(tagName)?.attributes ?? NO_ATTRIBUTES
}

/** What a declaration or type lets an element hold as QName-typed: its attributes by name, and whether its text. */
function qualifiedNamesOfContent(content: ContentDefinition): QualifiedNamesOfTag {
	const attributes = Object.entries(content.attributes.details)
		.filter(([, attribute]) => readsQualifiedNames(attribute.type))
		.map(([name]) => name)
	return { attributes: new Set(attributes), text: readsQualifiedNames(content.textContent?.type) }
}

/** The tags that may hold a QName-typed value, with what holds it, built once per definition and types. */
function qualifiedNameTagsOf(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'definition' | 'types'>
}): ReadonlyMap<string, QualifiedNamesOfTag> {
	const { definition, types } = params.dialecteConfig
	// a config may pair one definition with other types (a variant added): both make the key
	const cached = qualifiedNameTagsByDefinition.get(definition)?.get(types)
	if (cached !== undefined) return cached
	const tags = new Map<string, QualifiedNamesOfTag>()
	for (const [tagName, tagLevel] of Object.entries(definition)) {
		const declarations = [tagLevel, ...Object.values(tagLevel.declarations ?? {})]
		const contents: ContentDefinition[] = declarations.flatMap((declaration) => [
			declaration,
			...(declaration.variants ?? []).flatMap((variant) => types[variant] ?? []),
		])
		const held = contents.map(qualifiedNamesOfContent)
		const attributes = new Set(held.flatMap((names) => [...names.attributes]))
		const text = held.some((names) => names.text)
		if (attributes.size > 0 || text) tags.set(tagName, { attributes, text })
	}
	const byTypes = qualifiedNameTagsByDefinition.get(definition) ?? new WeakMap()
	byTypes.set(types, tags)
	qualifiedNameTagsByDefinition.set(definition, byTypes)
	return tags
}

const qualifiedNameTagsByDefinition = new WeakMap<
	object,
	WeakMap<object, ReadonlyMap<string, QualifiedNamesOfTag>>
>()
