import { throwDialecteError } from '@/errors'
import { XSD_NAMESPACE_URI } from '@/helpers/constant'
import { admittedXsiTypes, resolveDefinition } from '@/utils/resolve-definition'
import { isXsiTypeAttribute, resolveXsiType } from '@/utils/xsi-type'

import type { AnyAttribute, AnyDialecteConfig, AnyRelationship } from '@/types'
import type { ResolvableRecord } from '@/utils'

/**
 * Reject a write whose element names no type where its declared type is abstract, or names a type it may not take:
 * neither its declared type (when named, not abstract) nor one of its variants, or a value whose prefix is bound
 * nowhere. Runs on the WRITE path (`addChild`, `ensureChild`, clone, `update`) - never on import: a document is
 * loaded as it is, validation reports it. A built-in XSD type is not judged: the definition does not list the
 * built-in hierarchy.
 */
export function assertXsiTypeAdmitted(params: {
	dialecteConfig: AnyDialecteConfig
	record: ResolvableRecord
}): void {
	const { dialecteConfig, record } = params
	const attribute = record.attributes.find(isXsiTypeAttribute)

	if (attribute === undefined) {
		const declaration = resolveDefinition({ dialecteConfig, record })
		if (declaration?.abstractType) {
			throwDialecteError('XSI_TYPE_REQUIRED', {
				detail: `'${record.tagName}' is declared with an abstract type: name one of its variants with xsi:type (${admittedXsiTypes({ dialecteConfig, record }).join(', ')}).`,
				ref: { tagName: record.tagName },
			})
		}
		return
	}

	if (resolveDefinition({ dialecteConfig, record }) === undefined) return

	const named = resolveXsiType({ dialecteConfig, record })

	if (named?.namespace === XSD_NAMESPACE_URI) return

	const admitted = admittedXsiTypes({ dialecteConfig, record })
	if (named !== undefined && admitted.includes(named.clark)) return

	throwDialecteError('XSI_TYPE_NOT_ADMITTED', {
		detail: `'${record.tagName}' may not name the type '${String(attribute.value)}' with xsi:type; it admits ${admitted.join(', ') || 'none'}.`,
		ref: { tagName: record.tagName },
		meta: { value: attribute.value, admitted },
	})
}

/**
 * Reject an update that changes the type an element names while it keeps content the new type does not admit: the
 * attributes the new type would drop (clear them in the same update) and the children it does not hold (an update
 * touches attributes only: delete them first). Each is named in the error's `meta`.
 */
export function assertXsiTypeChangeLeavesNothing(params: {
	dialecteConfig: AnyDialecteConfig
	/** The attributes the update asks for: the stored ones merged with the new values. */
	merged: readonly AnyAttribute[]
	/** The record as the update stores it, standardized under its new type. */
	record: ResolvableRecord & { readonly children: readonly AnyRelationship[] }
}): void {
	const { dialecteConfig, merged, record } = params

	const kept = new Set(record.attributes.map((attribute) => attribute.name))
	const attributes = merged
		.filter((attribute) => attribute.value !== '' && !kept.has(attribute.name))
		.map((attribute) => attribute.name)
	const definition = resolveDefinition({ dialecteConfig, record })
	const held = new Set(definition?.children.sequence ?? [])
	const children = definition?.children.any
		? []
		: [...new Set(record.children.map((child) => child.tagName))].filter(
				(tagName) => !held.has(tagName),
			)

	if (attributes.length === 0 && children.length === 0) return

	throwDialecteError('XSI_TYPE_CHANGE_LEAVES_CONTENT', {
		detail:
			`'${record.tagName}' now names a type that does not admit ` +
			[
				attributes.length > 0
					? `the attributes ${attributes.join(', ')} (clear them in the same update)`
					: '',
				children.length > 0 ? `the children ${children.join(', ')} (delete them first)` : '',
			]
				.filter(Boolean)
				.join(' nor ') +
			'.',
		ref: { tagName: record.tagName },
		meta: { attributes, children },
	})
}
