/** The label of the queried text in a malformed-XML message. */
export const QUERIED_XML_LABEL = 'queried XML'

/** How many lines of context a failure message prints. */
export const FAILURE_CONTEXT_MAX_LINES = 200

/** How many candidates the `nearby` line lists. */
export const NEARBY_CANDIDATE_LIMIT = 10

/** The width of a message line's label column. */
export const MESSAGE_LABEL_WIDTH = 9

/** The indentation of a message line, and of the XML printed under `context` or `element`. */
export const MESSAGE_LINE_INDENT = '  '
export const MESSAGE_XML_INDENT = '    '

/** The first line of each failure message. */
export const FAILURE_HEADERS = {
	expectedNotFound: 'Expected element not found',
	unexpectedFound: 'Unexpected element found',
	refused: 'Query refused',
	unreliable: 'Unexpected element check unreliable',
} as const

/** The last line the engine keeps for a node: a node on a later line reads as this one. */
export const LAST_KEPT_LINE = 65535

/** The axis an abbreviated step separator stands for. */
export const ABBREVIATED_AXES: Record<string, string> = {
	'/': 'child',
	'//': 'descendant',
}

/** The XPath union operator. */
export const UNION_OPERATOR = '|'
