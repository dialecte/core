import type { AnyAttribute, AnyRawRecord, AnyRelationship } from '@/types'

/**
 * A copy of a stored record sharing no object with it, built field by field for the record's shape (several times
 * faster than `structuredClone` on it). A stored record is JSON (the store checked it on write); its attributes and
 * children are kept as given, so an item carrying more than its type is copied whole.
 */
export function cloneRecord(params: { record: AnyRawRecord }): AnyRawRecord {
	const { record } = params
	const { id, tagName, namespace, attributes, value, parent, children } = record
	return {
		id,
		tagName,
		namespace: { prefix: namespace.prefix, uri: namespace.uri },
		attributes: attributes.map((attribute) => cloneJsonObject({ value: attribute })),
		value,
		parent: parent === null ? null : { id: parent.id, tagName: parent.tagName },
		children: children.map((child) => cloneJsonObject({ value: child })),
	}
}

/** A copy of a JSON object (an attribute, a child reference), every object and array in it copied too. */
function cloneJsonObject<GenericObject extends AnyAttribute | AnyRelationship>(params: {
	value: GenericObject
}): GenericObject {
	return cloneJson({ value: params.value }) as GenericObject
}

function cloneJson(params: { value: unknown }): unknown {
	const { value } = params
	if (value === null || typeof value !== 'object') return value
	if (Array.isArray(value)) return value.map((item) => cloneJson({ value: item }))
	const copy: Record<string, unknown> = {}
	for (const key in value) copy[key] = cloneJson({ value: (value as Record<string, unknown>)[key] })
	return copy
}
