import { expect } from 'vitest'

import type { VersionTrail } from './read-model-harness.types'

/**
 * Asserts a known exposure: the cached answer equals the uncached answer of an older point (`staleAt`) and not the
 * newest one. `because` says what the cache misses; a fix of it turns this assertion red.
 *
 * @intent pin a read cache's known staleness in a test until it is fixed
 */
export function expectExposed<GenericAnswer>(params: {
	answer: GenericAnswer
	trail: VersionTrail<GenericAnswer>
	staleAt: number
	because: string
}): void {
	const { answer, trail, staleAt, because } = params
	expect(answer, because).toEqual(trail.answers[staleAt])
	expect(answer, because).not.toEqual(trail.answers.at(-1))
}
