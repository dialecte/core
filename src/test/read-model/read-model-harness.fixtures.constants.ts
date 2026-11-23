import type { HarnessTracked } from './read-model-harness.fixtures.types'

/** What a harness test file opened (each test file loads its own copy of this module), closed after each case. */
export const HARNESS_TRACKED: HarnessTracked = { projects: [], stores: [], restores: [] }
