import { importOutcomeOf } from './write-outcome'

import { describe, expect, it } from 'vitest'

import type { WriteOutcome } from './store.types'
import type { DocumentRecord, DocumentStatus } from '@/project/types'

function documentRecord(params: { id: string; status: DocumentStatus; writeId?: string }) {
	const { id, status, writeId } = params
	const record: DocumentRecord = {
		id,
		name: id,
		extension: '.xml',
		configKey: 'default',
		createdAt: 0,
		status,
		writeId,
	}
	return record
}

describe('importOutcomeOf', () => {
	type TestCase = { documents: DocumentRecord[]; expected: WriteOutcome }
	const testCases: Record<string, TestCase> = {
		'the document carrying the id is importing → running': {
			documents: [documentRecord({ id: 'a', status: 'importing', writeId: 'w' })],
			expected: 'running',
		},
		'the document carrying the id is ready → applied': {
			documents: [documentRecord({ id: 'a', status: 'ready', writeId: 'w' })],
			expected: 'applied',
		},
		'no document carries the id → not-applied': {
			documents: [
				documentRecord({ id: 'a', status: 'ready', writeId: 'other' }),
				documentRecord({ id: 'b', status: 'ready' }),
			],
			expected: 'not-applied',
		},
		'no document at all → not-applied': { documents: [], expected: 'not-applied' },
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			expect(importOutcomeOf({ documents: testCase.documents, writeId: 'w' })).toBe(
				testCase.expected,
			)
		})
	}
})
