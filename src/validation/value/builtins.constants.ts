import { parseBase64Binary, parseHexBinary } from './binary'
import {
	integerWithin,
	parseAnyString,
	parseAnyUri,
	parseBoolean,
	parseDecimalValue,
	stringMatching,
} from './builtins'
import { calendar, parseDuration } from './date-time'
import { floatingPoint } from './float'
import { isLanguage, isName, isNCName, isNmtoken } from './names'
import { parseQualifiedName } from './qualified-name'

import type { AtomicBuiltin } from './validate-value.types'

/** The atomic XSD built-ins core checks itself, by local name. */
export const ATOMIC_BUILTINS: Readonly<Record<string, AtomicBuiltin>> = {
	anySimpleType: { whiteSpace: 'preserve', parse: parseAnyString },
	string: { whiteSpace: 'preserve', parse: stringMatching() },
	normalizedString: { whiteSpace: 'replace', parse: stringMatching() },
	token: { whiteSpace: 'collapse', parse: stringMatching() },
	language: { whiteSpace: 'collapse', parse: stringMatching(isLanguage) },
	Name: { whiteSpace: 'collapse', parse: stringMatching(isName) },
	NCName: { whiteSpace: 'collapse', parse: stringMatching(isNCName) },
	NMTOKEN: { whiteSpace: 'collapse', parse: stringMatching(isNmtoken) },
	ID: { whiteSpace: 'collapse', parse: stringMatching(isNCName) },
	IDREF: { whiteSpace: 'collapse', parse: stringMatching(isNCName) },
	ENTITY: { whiteSpace: 'collapse', parse: stringMatching(isNCName) },
	QName: { whiteSpace: 'collapse', parse: parseQualifiedName },
	NOTATION: { whiteSpace: 'collapse', parse: parseQualifiedName },
	anyURI: { whiteSpace: 'collapse', parse: parseAnyUri },
	boolean: { whiteSpace: 'collapse', parse: parseBoolean },
	float: { whiteSpace: 'collapse', parse: floatingPoint({ single: true }) },
	double: { whiteSpace: 'collapse', parse: floatingPoint({ single: false }) },
	dateTime: { whiteSpace: 'collapse', parse: calendar({ primitive: 'dateTime' }) },
	date: { whiteSpace: 'collapse', parse: calendar({ primitive: 'date' }) },
	time: { whiteSpace: 'collapse', parse: calendar({ primitive: 'time' }) },
	gYearMonth: { whiteSpace: 'collapse', parse: calendar({ primitive: 'gYearMonth' }) },
	gYear: { whiteSpace: 'collapse', parse: calendar({ primitive: 'gYear' }) },
	gMonthDay: { whiteSpace: 'collapse', parse: calendar({ primitive: 'gMonthDay' }) },
	gMonth: { whiteSpace: 'collapse', parse: calendar({ primitive: 'gMonth' }) },
	gDay: { whiteSpace: 'collapse', parse: calendar({ primitive: 'gDay' }) },
	duration: { whiteSpace: 'collapse', parse: parseDuration },
	hexBinary: { whiteSpace: 'collapse', parse: parseHexBinary },
	base64Binary: { whiteSpace: 'collapse', parse: parseBase64Binary },
	decimal: { whiteSpace: 'collapse', parse: parseDecimalValue },
	integer: { whiteSpace: 'collapse', parse: integerWithin({}) },
	nonPositiveInteger: { whiteSpace: 'collapse', parse: integerWithin({ max: '0' }) },
	negativeInteger: { whiteSpace: 'collapse', parse: integerWithin({ max: '-1' }) },
	nonNegativeInteger: { whiteSpace: 'collapse', parse: integerWithin({ min: '0' }) },
	positiveInteger: { whiteSpace: 'collapse', parse: integerWithin({ min: '1' }) },
	long: {
		whiteSpace: 'collapse',
		parse: integerWithin({ min: '-9223372036854775808', max: '9223372036854775807' }),
	},
	int: { whiteSpace: 'collapse', parse: integerWithin({ min: '-2147483648', max: '2147483647' }) },
	short: { whiteSpace: 'collapse', parse: integerWithin({ min: '-32768', max: '32767' }) },
	byte: { whiteSpace: 'collapse', parse: integerWithin({ min: '-128', max: '127' }) },
	unsignedLong: {
		whiteSpace: 'collapse',
		parse: integerWithin({ min: '0', max: '18446744073709551615' }),
	},
	unsignedInt: { whiteSpace: 'collapse', parse: integerWithin({ min: '0', max: '4294967295' }) },
	unsignedShort: { whiteSpace: 'collapse', parse: integerWithin({ min: '0', max: '65535' }) },
	unsignedByte: { whiteSpace: 'collapse', parse: integerWithin({ min: '0', max: '255' }) },
}

/** The list built-ins: the built-in of their items; each holds one item at least. */
export const LIST_BUILTINS: Readonly<Record<string, string>> = {
	NMTOKENS: 'NMTOKEN',
	IDREFS: 'IDREF',
	ENTITIES: 'ENTITY',
}
