import type { DataType } from '@/types'

/**
 * The values a datatype enumerates: its own enumeration, else those its union members enumerate - a member
 * restricted by a pattern alone enumerates none. A qualified name's values are written `{uri}local`.
 *
 * @intent list the allowed values of an attribute, read the enumeration of a datatype, fill a dropdown with allowed values
 */
export function enumeratedValues(datatype: DataType | undefined): readonly string[] {
	if (datatype === undefined) return []
	if (datatype.facets?.enumeration !== undefined) return datatype.facets.enumeration
	if (!('union' in datatype)) return []
	return [...new Set(datatype.union.flatMap(enumeratedValues))]
}

/**
 * The patterns of a datatype's own levels, each anchored to the whole value and compiled with the `u` flag the
 * definition writes them for: a value must match every one (one pattern of a level is enough within it).
 *
 * @intent validate an attribute value against its datatype patterns, get the regular expressions an attribute value must match
 */
export function valuePatterns(datatype: DataType | undefined): readonly RegExp[] {
	return (datatype?.facets?.pattern ?? []).map(
		(level) => new RegExp(`^(?:${level.map((pattern) => `(?:${pattern})`).join('|')})$`, 'u'),
	)
}
