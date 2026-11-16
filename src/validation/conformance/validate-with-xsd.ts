import { XmlValidateError } from '@/test/xml/engine'

import type { OracleError } from './conformance.types'
import type { XmlDocument, XsdValidator } from '@/test/xml/engine'

/** libxml2's errors on `instance`: its line, wording and path per error; none when the document is valid. */
export function validateWithXsd(params: {
	validator: XsdValidator
	instance: XmlDocument
}): readonly OracleError[] {
	const { validator, instance } = params
	try {
		validator.validate(instance)
		return []
	} catch (error) {
		if (!(error instanceof XmlValidateError)) throw error
		return error.details.map(function toOracleError(detail) {
			return {
				line: detail.line,
				message: detail.message,
				...(detail.xpath !== undefined && { xpath: detail.xpath }),
			}
		})
	}
}
