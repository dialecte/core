import { expect } from 'vitest'

import type { VersionTrail } from './read-model-harness.types'

/**
 * Asserts a cached answer is a snapshot: equal to one of the uncached answers the trail recorded from point `from` (the
 * session's start) on. Whether a later read moved on is the case's own next assertion.
 *
 * @intent assert a cached read answers a moment of its session
 */
export function expectSnapshot<GenericAnswer>(params: {
	answer: GenericAnswer
	trail: VersionTrail<GenericAnswer>
	from: number
	/** An answer the session gave before this one: this one may not be of an older point. */
	notBefore?: GenericAnswer
}): void {
	const { answer, trail, from, notBefore } = params
	const points = trail.answers.slice(from)
	expect(points).toContainEqual(answer)
	if (notBefore === undefined) return
	// the newest point the answer can be, against the oldest the earlier answer can be: never older
	const latestOfAnswer = points.findLastIndex((point) => sameAnswer({ left: point, right: answer }))
	const earliestBefore = points.findIndex((point) => sameAnswer({ left: point, right: notBefore }))
	expect(
		latestOfAnswer,
		'an answer goes back to an older point than one given before',
	).toBeGreaterThanOrEqual(earliestBefore)
}

/** Two answers alike as data (answers are plain values: records, strings, lists). */
function sameAnswer(params: { left: unknown; right: unknown }): boolean {
	return JSON.stringify(params.left) === JSON.stringify(params.right)
}
