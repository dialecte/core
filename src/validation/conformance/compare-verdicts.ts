import { throwDialecteError } from '@/errors'

import type { OracleError, OracleIssue } from './conformance.types'

/**
 * The oracle's comparison, on plain data: libxml2's errors (by line) against the engine's flagged issues and the
 * case's expectation. The engine must flag exactly the records libxml2 flags, one issue per record, each with the
 * case's code and attribute.
 *
 * @throws naming the case for an error without a line, naming the line for one the map does not know, naming the
 *   record for an id flagged by one side only or expected twice, naming the attribute and code of a second issue
 */
export function compareVerdicts(params: {
	name: string
	errors: readonly OracleError[]
	idsByLine: ReadonlyMap<number, string>
	flagged: readonly OracleIssue[]
	expected: 'valid' | readonly OracleIssue[]
}): void {
	const { name, errors, idsByLine, flagged } = params
	const expected = params.expected === 'valid' ? [] : params.expected

	function fail(reason: string): never {
		return throwDialecteError('ASSERTION_FAILED', {
			detail: `oracle case '${name}': ${reason}\n${describeErrors({ errors })}`,
		})
	}

	const judged = new Set<string>()
	for (const { line } of errors) {
		if (!(line >= 1)) fail('libxml2 reports an error without a line')
		const id = idsByLine.get(line)
		if (id === undefined) fail(`libxml2 reports an error on line ${line}, where no element starts`)
		judged.add(id)
	}

	const expectedById = new Map<string, OracleIssue>()
	for (const issue of expected) {
		if (expectedById.has(issue.at)) fail(`the case expects record '${issue.at}' twice`)
		expectedById.set(issue.at, issue)
	}

	const flaggedById = new Map<string, OracleIssue[]>()
	for (const issue of flagged) {
		flaggedById.set(issue.at, [...(flaggedById.get(issue.at) ?? []), issue])
	}

	for (const id of flaggedById.keys()) {
		if (!judged.has(id)) fail(`the engine flags record '${id}', libxml2 does not`)
	}
	for (const id of judged) {
		if (!flaggedById.has(id)) fail(`libxml2 flags record '${id}', the engine does not`)
		if (!expectedById.has(id)) fail(`libxml2 flags record '${id}', the case does not expect it`)
	}
	for (const id of expectedById.keys()) {
		if (!judged.has(id)) fail(`the case expects record '${id}', libxml2 does not flag it`)
	}

	for (const [id, issue] of expectedById) {
		const [first, second] = flaggedById.get(id) ?? []
		if (second !== undefined) {
			fail(
				`the engine flags record '${id}' twice: a second issue ${describeIssue(second)} after ${describeIssue(first)}`,
			)
		}
		if (first?.code !== issue.code || first.attribute !== issue.attribute) {
			fail(
				`record '${id}': the case expects ${describeIssue(issue)}, the engine flags ${describeIssue(first)}`,
			)
		}
	}
}

/** An issue as a mismatch names it: its code and its attribute (`text` for a text value). */
function describeIssue(issue: OracleIssue | undefined): string {
	if (issue === undefined) return 'nothing'
	const where = issue.attribute === undefined ? 'the text' : `attribute '${issue.attribute}'`
	return `code '${issue.code}' on ${where}`
}

/** libxml2's errors as printed under a mismatch: line, wording, path - read by a person, never parsed. */
function describeErrors(params: { errors: readonly OracleError[] }): string {
	const { errors } = params
	if (errors.length === 0) return 'libxml2: no error'
	const lines = errors.map(function describeError({ line, message, xpath }) {
		return `  line ${line}: ${message.trim()}${xpath === undefined ? '' : ` (${xpath})`}`
	})
	return ['libxml2:', ...lines].join('\n')
}
