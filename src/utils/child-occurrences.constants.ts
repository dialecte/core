import type { ChildOccurrences } from './child-occurrences.types'

/** A child the content model does not constrain: optional, unbounded. */
export const UNCONSTRAINED: ChildOccurrences = { min: 0, max: undefined }
