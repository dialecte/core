import { checkJsonValues, toJsonCopy } from './json-values'

/** The two members every store checks a write through. */
export const JSON_VALUE_MEMBERS: Record<string, (value: unknown) => unknown> = {
	checkJsonValues: (value) => checkJsonValues({ value }),
	toJsonCopy: (value) => toJsonCopy({ value }),
}
