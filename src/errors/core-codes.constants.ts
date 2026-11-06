import { ERROR_CATALOG } from './codes.constants'

/** The codes of core's own catalogue: a dialecte's entry may not reuse one. */
export const CORE_CODES = new Set<string>(Object.values(ERROR_CATALOG).map((entry) => entry.code))
