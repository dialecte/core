import type { AnyAttribute, Namespace } from '@/types'

/**
 * What `assertXmlCharacters` reads of a record written, or of a patch of one (`tagName`, `namespace` and `value`
 * then optional): its texts (value, namespace URI, attribute values and namespace URIs) and its names (tag name,
 * namespace prefix, attribute names and prefixes).
 */
export type XmlCharactersWrite = {
	id: string
	tagName?: string
	namespace?: Namespace
	value?: string
	attributes?: readonly AnyAttribute[]
}

/** Which part of a record (or of one of its attributes) holds a character XML does not allow. */
export type NotXmlCharacterPart = 'value' | 'namespace' | 'name' | 'prefix' | 'id'

/** Where a character XML does not allow sits in a record. */
export type NotXmlCharacterPlace = {
	part: NotXmlCharacterPart
	/** The attribute holding it, by name; absent for the record's own parts */
	attribute?: string
}

/** The first character XML does not allow in a record (`U+XXXX`), and where it sits. */
export type NotXmlCharacterFound = NotXmlCharacterPlace & { character: string }
