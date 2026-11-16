import testExtSchema from '@/test/generated/test-ext.xsd?raw'
import testSchema from '@/test/generated/test.xsd?raw'

import type { KnownExceptionReason } from './conformance.types'
import type { SAXOptions } from 'sax'

/** sax over a case document: positions on (the line of each start tag), names and text as written. */
export const RECORD_LINES_SAX_OPTIONS: SAXOptions = {
	lowercase: false,
	trim: false,
	normalize: false,
	position: true,
	xmlns: false,
}

/** The closed vocabulary of `known-exceptions.json`: why core and libxml2 disagree. */
export const KNOWN_EXCEPTION_REASONS: readonly KnownExceptionReason[] = [
	'xsd-rule',
	'capability-gap',
]

/** The schema file libxml2 judges a case document against: it imports its sibling by this relative name. */
export const TEST_SCHEMA_ENTRY = 'test.xsd'

/** Core's committed test schema, by the name an `xs:import` asks for. */
export const TEST_SCHEMA_FILES: Readonly<Record<string, string>> = {
	[TEST_SCHEMA_ENTRY]: testSchema,
	'test-ext.xsd': testExtSchema,
}

/** The one element a value is judged in by `libxml2AdmitsValue`. */
export const ONE_VALUE_ELEMENT = 'v'
