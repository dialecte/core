import { completionThresholdOf } from './transaction-read-cache'
import { COMPLETE_TAG_AT_LOOKUP } from './transaction-read-cache.constants'

import { describe, expect, it } from 'vitest'

// A tag is read whole at its 8th lookup of a transaction; a document above 250,000 records waits until the lookups
// have cost about what reading that many records does (one lookup ~ 2,000 records read).
describe('completionThresholdOf - when a tag is read whole', () => {
	type Case = { documentCount: number; threshold: number }
	const cases: Case[] = [
		{ documentCount: 0, threshold: COMPLETE_TAG_AT_LOOKUP },
		{ documentCount: 59_041, threshold: COMPLETE_TAG_AT_LOOKUP },
		{ documentCount: 250_000, threshold: COMPLETE_TAG_AT_LOOKUP },
		{ documentCount: 1_000_000, threshold: 500 },
	]

	it.each(cases)('a document of $documentCount records → at lookup $threshold', (testCase) => {
		expect(completionThresholdOf({ documentCount: testCase.documentCount })).toBe(
			testCase.threshold,
		)
	})
})
