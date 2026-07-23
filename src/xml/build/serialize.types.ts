/**
 * Render controls for {@link xmlDocumentToString}.
 */
export type SerializeOptions = {
	/**
	 * Prepend the XML prolog (`<?xml version="1.0" encoding="UTF-8"?>`).
	 * Defaults to `true`. Set `false` to emit the serialized element(s) without
	 * the declaration, e.g. for an excerpt embedded in another document.
	 */
	includeXmlDeclaration?: boolean
}
