import { ATOMIC_BUILTINS, LIST_BUILTINS } from './builtins.constants'

import { describe, expect, it } from 'vitest'

import { XSD_BUILTIN_BASES } from '@/utils/xsd-builtins.constants'

// The built-ins are named twice: by the derivation table the xsi:type rule climbs, and by the tables values are
// checked with. Both name the same built-ins (anyType, the root of the derivation, is in neither as a key).
describe('the XSD built-in tables', () => {
	it('the derivation table names exactly the built-ins values are checked as', () => {
		const derived = Object.keys(XSD_BUILTIN_BASES).sort()
		const checked = [...Object.keys(ATOMIC_BUILTINS), ...Object.keys(LIST_BUILTINS)].sort()
		expect(derived).toEqual(checked)
	})
})
