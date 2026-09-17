import { normalizeUuids } from './normalize-uuids'

import { describe, expect, it } from 'vitest'

describe('normalizeUuids', () => {
	it('maps each distinct uuid to a stable first-appearance token', () => {
		const input =
			'<A uuid="e80d5153-a179-4d5f-a653-f5bff679e869"><B uuid="58b2e5cc-f09f-4d3e-85ce-9a88a8a0fbd5"/></A>'
		expect(normalizeUuids(input)).toBe('<A uuid="uuid-1"><B uuid="uuid-2"/></A>')
	})

	it('preserves relationships — the same uuid becomes the same token', () => {
		const input =
			'<Function uuid="d996cde9-fc40-4510-8b08-d685da2be6e5"/><Ref target="d996cde9-fc40-4510-8b08-d685da2be6e5"/>'
		expect(normalizeUuids(input)).toBe('<Function uuid="uuid-1"/><Ref target="uuid-1"/>')
	})

	it('leaves non-uuid ids untouched', () => {
		const input = '<A uuid="var-src-uuid" id="app-1"/>'
		expect(normalizeUuids(input)).toBe(input)
	})

	it('is idempotent', () => {
		const input = '<A uuid="e80d5153-a179-4d5f-a653-f5bff679e869"/>'
		const once = normalizeUuids(input)
		expect(normalizeUuids(once)).toBe(once)
	})
})
