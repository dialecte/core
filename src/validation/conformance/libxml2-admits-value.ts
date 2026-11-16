import { ONE_VALUE_ELEMENT } from './conformance.constants'
import { validateWithXsd } from './validate-with-xsd'

import { XSD_NAMESPACE_URI } from '@/helpers'
import { XmlDocument, XsdValidator } from '@/test/xml/engine'
import { escapeCompactTextValue } from '@/xml/build/xml-element'

/**
 * Whether libxml2 admits `value` as the content of a one-element document judged against `xsd`, an `xs:simpleType`
 * named `t`.
 */
export function libxml2AdmitsValue(params: { xsd: string; value: string }): boolean {
	const { xsd, value } = params
	const schema = XmlDocument.fromString(
		`<xs:schema xmlns:xs="${XSD_NAMESPACE_URI}">${xsd}<xs:element name="${ONE_VALUE_ELEMENT}" type="t"/></xs:schema>`,
	)
	try {
		const validator = XsdValidator.fromDoc(schema)
		try {
			const instance = XmlDocument.fromString(
				`<${ONE_VALUE_ELEMENT}>${escapeCompactTextValue(value)}</${ONE_VALUE_ELEMENT}>`,
			)
			try {
				return validateWithXsd({ validator, instance }).length === 0
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
