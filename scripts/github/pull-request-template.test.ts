/**
 * The pull request template is the one `dialecte lot describe` renders a lot's body through: a template without its
 * markers, or with them out of order, is refused and no lot lands.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKAGE_ROOT } from '../test-scope/test-scope.constants'
import {
	FILLED_PARTS,
	KEPT_PART,
	PART_MARKER_PATTERN,
	REVIEWER_CHECKLIST_HEADING,
	TEMPLATE_PATH,
} from './pull-request-template.constants'

import { describe, expect, it } from 'vitest'

/** The committed template's lines. */
function templateLines(): string[] {
	return readFileSync(join(PACKAGE_ROOT, TEMPLATE_PATH), 'utf8').split('\n')
}

/** The parts the template marks, in the order its lines hold them. */
function markedParts(params: { lines: string[] }): string[] {
	return params.lines.flatMap(function partOf(line) {
		const match = PART_MARKER_PATTERN.exec(line)
		return match ? [match[1]] : []
	})
}

describe('the pull request template', () => {
	it("the committed template -> every filled part's marker once, in order", () => {
		const parts = markedParts({ lines: templateLines() })
		expect(parts.filter((part) => part !== KEPT_PART)).toEqual(FILLED_PARTS)
	})

	it("the committed template -> the kept marker after the filled parts, the reviewer's checklist after it", () => {
		const lines = templateLines()
		const parts = markedParts({ lines })
		const kept = lines.indexOf(`<!-- dialecte:${KEPT_PART} -->`)
		expect(parts.at(-1)).toBe(KEPT_PART)
		expect(parts.filter((part) => part === KEPT_PART)).toHaveLength(1)
		expect(lines.indexOf(REVIEWER_CHECKLIST_HEADING)).toBeGreaterThan(kept)
	})
})
