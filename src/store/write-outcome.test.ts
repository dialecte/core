import { importOutcomeOf } from './write-outcome'

import { describe, expect, it } from 'vitest'

import { writeOutcomeOf } from '@/index'

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
	type TestCase = {
		documents: DocumentRecord[]
		/** What the store says of the import of the id, when it can tell. */
		running?: boolean
		expected: WriteOutcome
	}
	const testCases: Record<string, TestCase> = {
		'the document carrying the id is importing → running': {
			documents: [documentRecord({ id: 'a', status: 'importing', writeId: 'w' })],
			expected: 'running',
		},
		'the document carrying the id is importing, its import running → running': {
			documents: [documentRecord({ id: 'a', status: 'importing', writeId: 'w' })],
			running: true,
			expected: 'running',
		},
		'the document carrying the id is importing, its import not running (its removal failed) → not-applied':
			{
				documents: [documentRecord({ id: 'a', status: 'importing', writeId: 'w' })],
				running: false,
				expected: 'not-applied',
			},
		'the document carrying the id is ready, no import of it running → applied': {
			documents: [documentRecord({ id: 'a', status: 'ready', writeId: 'w' })],
			running: false,
			expected: 'applied',
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
			const { running } = testCase
			const isRunning = running === undefined ? undefined : () => running
			expect(importOutcomeOf({ documents: testCase.documents, writeId: 'w', isRunning })).toBe(
				testCase.expected,
			)
		})
	}
})

describe('writeOutcomeOf (what a custom store answers, from the package)', () => {
	type TestCase = { documents: DocumentRecord[]; committed: boolean; expected: WriteOutcome }
	const testCases: Record<string, TestCase> = {
		'an import running under the id → running, whatever the history says': {
			documents: [documentRecord({ id: 'a', status: 'importing', writeId: 'w' })],
			committed: true,
			expected: 'running',
		},
		'an imported document ready under the id → applied': {
			documents: [documentRecord({ id: 'a', status: 'ready', writeId: 'w' })],
			committed: false,
			expected: 'applied',
		},
		'no document carries the id, a history entry does → applied': {
			documents: [documentRecord({ id: 'a', status: 'ready', writeId: 'other' })],
			committed: true,
			expected: 'applied',
		},
		'neither a document nor a history entry carries the id → not-applied': {
			documents: [documentRecord({ id: 'a', status: 'ready', writeId: 'other' })],
			committed: false,
			expected: 'not-applied',
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, () => {
			const { documents, committed, expected } = testCase
			expect(writeOutcomeOf({ documents, writeId: 'w', committed })).toBe(expected)
		})
	}
})
