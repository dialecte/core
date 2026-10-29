import { throwDialecteError } from '@/errors'
import { notXmlCharacterOf } from '@/utils/xml-characters'

import type {
	NotXmlCharacterFound,
	NotXmlCharacterPart,
	NotXmlCharacterPlace,
	XmlCharactersWrite,
} from './assert-xml-characters.types'

/**
 * Refuse a record, or a patch of one, holding a character XML does not allow (a control character below U+0020
 * but tab, line feed and carriage return, U+FFFE, U+FFFF) in what the writer copies into a file: its texts (value,
 * namespace URI, attribute values and namespace URIs), its names (tag name, namespace prefix, attribute names and
 * prefixes) and, with `withId` (a file written with the database ids), its id. XML can hold no such character, as
 * written or as a character reference. Whether a name is otherwise a valid XML name is not checked here.
 * `XML_CHARACTER_NOT_ALLOWED`, `meta`: `recordId`, `tagName` (when the write names it), `attribute` (its name, when
 * in an attribute), `part` (`'value' | 'namespace' | 'name' | 'prefix' | 'id'`) and `character` (`U+XXXX`).
 */
export function assertXmlCharacters(params: {
	record: XmlCharactersWrite
	withId?: boolean
}): void {
	const { record, withId = false } = params
	const found =
		findNotXmlCharacterInText({ record }) ?? findNotXmlCharacterInNames({ record, withId })
	if (!found) return
	const { character, attribute, part } = found
	const element = record.tagName
		? `<${record.tagName}> '${record.id}'`
		: `the record '${record.id}'`
	throwDialecteError('XML_CHARACTER_NOT_ALLOWED', {
		detail: `${describePlace({ place: found, element })} holds ${character}, a character XML does not allow.`,
		...(record.tagName && { ref: { tagName: record.tagName, id: record.id } }),
		meta: {
			recordId: record.id,
			...(record.tagName && { tagName: record.tagName }),
			...(attribute && { attribute }),
			part,
			character,
		},
	})
}

/**
 * The first character XML does not allow in the texts of `record` - its value, its namespace URI, then each
 * attribute's value and namespace URI - and where it sits; `undefined` when none.
 */
export function findNotXmlCharacterInText(params: {
	record: XmlCharactersWrite
}): NotXmlCharacterFound | undefined {
	const { record } = params
	const inValue =
		record.value === undefined
			? undefined
			: notXmlCharacterAt({ text: record.value, part: 'value' })
	if (inValue) return inValue
	const inNamespace =
		record.namespace && notXmlCharacterAt({ text: record.namespace.uri, part: 'namespace' })
	if (inNamespace) return inNamespace
	for (const attribute of record.attributes ?? []) {
		const inAttribute =
			notXmlCharacterAt({ text: attribute.value, part: 'value', attribute: attribute.name }) ??
			(attribute.namespace &&
				notXmlCharacterAt({
					text: attribute.namespace.uri,
					part: 'namespace',
					attribute: attribute.name,
				}))
		if (inAttribute) return inAttribute
	}
	return undefined
}

/**
 * The first character XML does not allow in the names of `record` - its tag name, its namespace prefix, then each
 * attribute's prefix and name, and its id with `withId` - and where it sits; `undefined` when none.
 */
export function findNotXmlCharacterInNames(params: {
	record: XmlCharactersWrite
	withId: boolean
}): NotXmlCharacterFound | undefined {
	const { record, withId } = params
	const inTagName =
		record.tagName === undefined
			? undefined
			: notXmlCharacterAt({ text: record.tagName, part: 'name' })
	if (inTagName) return inTagName
	const inPrefix =
		record.namespace && notXmlCharacterAt({ text: record.namespace.prefix, part: 'prefix' })
	if (inPrefix) return inPrefix
	for (const attribute of record.attributes ?? []) {
		// a prefixed attribute's name holds its prefix: the prefix first, so a bad prefix is named as such
		const inAttribute =
			(attribute.namespace &&
				notXmlCharacterAt({
					text: attribute.namespace.prefix,
					part: 'prefix',
					attribute: attribute.name,
				})) ||
			notXmlCharacterAt({ text: attribute.name, part: 'name', attribute: attribute.name })
		if (inAttribute) return inAttribute
	}
	return withId ? notXmlCharacterAt({ text: record.id, part: 'id' }) : undefined
}

/** Where a character sits, as a sentence begins: `The value of <A> 'a-1'`, `The attribute aA of ...`. */
export function describePlace(params: { place: NotXmlCharacterPlace; element: string }): string {
	const { place, element } = params
	const { part, attribute } = place
	if (attribute) {
		if (part === 'value') return `The attribute ${attribute} of ${element}`
		if (part === 'name') return `The name of the attribute ${attribute} of ${element}`
		const what = part === 'prefix' ? 'namespace prefix' : 'namespace URI'
		return `The ${what} of the attribute ${attribute} of ${element}`
	}
	if (part === 'name') return `The tag name of ${element}`
	if (part === 'prefix') return `The namespace prefix of ${element}`
	if (part === 'namespace') return `The namespace URI of ${element}`
	if (part === 'id') return `The id of ${element}`
	return `The value of ${element}`
}

function notXmlCharacterAt(params: {
	text: string
	part: NotXmlCharacterPart
	attribute?: string
}): NotXmlCharacterFound | undefined {
	const { text, part, attribute } = params
	const character = notXmlCharacterOf({ text })
	if (!character) return undefined
	return { character, part, ...(attribute !== undefined && { attribute }) }
}
