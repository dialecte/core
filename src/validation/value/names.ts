import { LANGUAGE, NAME, NMTOKEN, XML_CHARACTERS } from './names.constants'

/** Whether a value is made of XML characters only. */
export function isXmlCharacters(value: string): boolean {
	return XML_CHARACTERS.test(value)
}

/** An XML `Name`: a name start character, then name characters (the XML 1.0 sets, `été` included). */
export function isName(value: string): boolean {
	return NAME.test(value)
}

/** A name without a colon. */
export function isNCName(value: string): boolean {
	return !value.includes(':') && NAME.test(value)
}

/** An XML `NMTOKEN`: one name character at least, any of them first. */
export function isNmtoken(value: string): boolean {
	return NMTOKEN.test(value)
}

/** `NCName` or `NCName:NCName`. */
export function isQName(value: string): boolean {
	const parts = value.split(':')
	return parts.length <= 2 && parts.every(isNCName)
}

/** A `language` tag: letters (1 to 8), then `-` and letters or digits (1 to 8), any number of times. */
export function isLanguage(value: string): boolean {
	return LANGUAGE.test(value)
}
