import type { VersionTrail } from './read-model-harness.types'

/**
 * The uncached answers of a case, recorded at the points it chooses (its start, after each write it scripts): what a
 * cached answer may equal.
 *
 * @intent record the uncached answers of a read over a test's writes
 */
export function createVersionTrail<GenericAnswer>(params: {
	answer: () => Promise<GenericAnswer>
}): VersionTrail<GenericAnswer> {
	const answers: GenericAnswer[] = []
	return {
		answers,
		record: async function record() {
			const answer = await params.answer()
			answers.push(answer)
		},
	}
}
