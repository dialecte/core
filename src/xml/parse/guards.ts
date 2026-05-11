import type * as sax from 'sax'

export function isSaxQualifiedTag(node: sax.Tag | sax.QualifiedTag): node is sax.QualifiedTag {
	return 'prefix' in node && 'uri' in node && !!node.prefix && !!node.uri
}

export function isSaxQualifiedAttribute(
	attribute: string | sax.QualifiedAttribute | undefined,
): attribute is sax.QualifiedAttribute {
	return (
		attribute !== undefined &&
		typeof attribute !== 'string' &&
		typeof attribute === 'object' &&
		'prefix' in attribute &&
		!!attribute.prefix &&
		'uri' in attribute &&
		!!attribute.uri
	)
}
