import { TEST_SCHEMA_ENTRY, TEST_SCHEMA_FILES } from './conformance.constants'
import { validateWithXsd } from './validate-with-xsd'

import { CUSTOM_RECORD_ID_ATTRIBUTE_NAME, DIALECTE_DEV_NAMESPACE } from '@/helpers'
import {
	ParseOption,
	XmlAttribute,
	XmlBufferInputProvider,
	XmlDocument,
	XsdValidator,
	xmlRegisterInputProvider,
} from '@/test/xml/engine'

import type { OracleError } from './conformance.types'

// the schema's xs:import reads its sibling from memory: one provider for the whole run (modules are shared)
xmlRegisterInputProvider(new XmlBufferInputProvider(schemaBuffers()))

/**
 * What libxml2 reports of a document against core's test schema: the record id attributes removed in place (lines
 * unchanged), the rest validated. No error means valid.
 */
export function judgeWithLibxml2(params: { document: string }): readonly OracleError[] {
	const { document: source } = params
	const schema = XmlDocument.fromString(TEST_SCHEMA_FILES[TEST_SCHEMA_ENTRY] ?? '', {
		url: TEST_SCHEMA_ENTRY,
	})
	try {
		const validator = XsdValidator.fromDoc(schema)
		try {
			const instance = XmlDocument.fromString(source, {
				option: ParseOption.XML_PARSE_BIG_LINES,
			})
			try {
				removeRecordIds({ instance })
				return validateWithXsd({ validator, instance })
			} finally {
				instance.dispose()
			}
		} finally {
			validator.dispose()
		}
	} finally {
		schema.dispose()
	}
}

/** Every record id attribute removed from the parsed tree: the lines of what remains do not move. */
function removeRecordIds(params: { instance: XmlDocument }): void {
	const { instance } = params
	const prefix = DIALECTE_DEV_NAMESPACE.prefix
	const recordIds = instance.find(`//@${prefix}:${CUSTOM_RECORD_ID_ATTRIBUTE_NAME}`, {
		[prefix]: DIALECTE_DEV_NAMESPACE.uri,
	})
	for (const recordId of recordIds) {
		if (recordId instanceof XmlAttribute) recordId.remove()
	}
}

/** The committed schema files as the buffers the input provider serves, by the name the import asks for. */
function schemaBuffers(): Record<string, Uint8Array> {
	const encoder = new TextEncoder()
	return Object.fromEntries(
		Object.entries(TEST_SCHEMA_FILES).map(([name, text]) => [name, encoder.encode(text)]),
	)
}
