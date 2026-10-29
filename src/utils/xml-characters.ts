import { NOT_XML_CHARACTER } from './xml-characters.constants'

/**
 * The first character of `text` XML does not allow (a control character below U+0020 other than tab, line feed
 * and carriage return, U+FFFE, U+FFFF), named as `U+XXXX`; `undefined` when there is none.
 */
export function notXmlCharacterOf(params: { text: string }): string | undefined {
	const match = NOT_XML_CHARACTER.exec(params.text)
	if (!match) return undefined
	return `U+${match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`
}
