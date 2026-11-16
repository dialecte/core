import { validateValue } from './validate-value'

import { expect, it } from 'vitest'

import type { ValueCase } from './validate-value.fixtures.types'

export function runCases(testCases: Record<string, ValueCase>): void {
	for (const [name, { type, value, namespaces, expected }] of Object.entries(testCases)) {
		it(name, () => expect(validateValue({ value, type, namespaces })).toEqual(expected))
	}
}

/** `p` bound to urn:p, the default namespace urn:default. */
export function pAndDefault(prefix: string): string | undefined {
	return ({ p: 'urn:p', '': 'urn:default' } as Record<string, string>)[prefix]
}
