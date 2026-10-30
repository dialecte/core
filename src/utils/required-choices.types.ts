import type { ChildOccurrences } from './child-occurrences.types'

/**
 * A choice a content model requires: taken at least `min` times wherever the element is, one of its
 * `branches` each time.
 */
export type RequiredChoice = {
	readonly min: number
	readonly branches: readonly ChoiceBranch[]
}

/** One branch of a choice: how often it holds each child, and the choices it requires in turn when taken. */
export type ChoiceBranch = {
	readonly children: Readonly<Record<string, ChildOccurrences>>
	readonly choices: readonly RequiredChoice[]
}
