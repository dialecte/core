/** Where the repository keeps its pull request template, from the package root. */
export const TEMPLATE_PATH = '.github/pull_request_template.md'

/** A template line `dialecte lot pr` fills: `<!-- dialecte:<part> -->` alone on its line. */
export const PART_MARKER_PATTERN = /^<!-- dialecte:([a-z]+) -->$/

/** The parts the renderer fills from a lot's records, in the order the body shows them. */
export const FILLED_PARTS = [
	'summary',
	'behaviours',
	'changelog',
	'tests',
	'review',
	'risk',
	'overlaps',
	'depends',
	'issue',
	'checklist',
] as const

/** The part whose text a person owns once the pull request exists: kept when the body is rendered again. */
export const KEPT_PART = 'kept'

/** The heading of the reviewer's checklist: the person's part, after the kept marker. */
export const REVIEWER_CHECKLIST_HEADING = '### Checklist for the reviewer when doing the PR review'
