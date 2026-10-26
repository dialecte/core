import { removeUnfinishedImports } from './unfinished-imports'

import { describe, expect, it } from 'vitest'

import type { DocumentRecord, DocumentStatus } from '@/project/types'

function documentRecord(params: { id: string; status: DocumentStatus }): DocumentRecord {
	const { id, status } = params
	return {
		id,
		name: id,
		extension: '.xml',
		configKey: 'default',
		createdAt: 0,
		status,
		writeId: `w-${id}`,
	}
}

describe('removeUnfinishedImports', () => {
	type TestCase = {
		/** what the registry lists when the sweep starts */
		listed: DocumentStatus
		/** the import still runs elsewhere */
		running: boolean
		/** what the registry holds when the row is read again; absent = removed meanwhile */
		reread?: DocumentStatus
		expectedRemoved: boolean
	}
	const testCases: Record<string, TestCase> = {
		'importing, no import runs it, still importing → removed': {
			listed: 'importing',
			running: false,
			reread: 'importing',
			expectedRemoved: true,
		},
		'importing, its import still runs → kept': {
			listed: 'importing',
			running: true,
			reread: 'importing',
			expectedRemoved: false,
		},
		'importing when listed, ready when read again (its import ended meanwhile) → kept': {
			listed: 'importing',
			running: false,
			reread: 'ready',
			expectedRemoved: false,
		},
		'importing when listed, gone when read again → nothing removed': {
			listed: 'importing',
			running: false,
			expectedRemoved: false,
		},
		'ready → kept, never asked': {
			listed: 'ready',
			running: false,
			reread: 'ready',
			expectedRemoved: false,
		},
	}

	for (const [description, testCase] of Object.entries(testCases)) {
		it(description, async () => {
			const removed: string[] = []
			await removeUnfinishedImports({
				store: {
					getDocuments: async () => [documentRecord({ id: 'a', status: testCase.listed })],
					getDocument: async (id) =>
						testCase.reread && documentRecord({ id, status: testCase.reread }),
					removeDocument: async (id) => {
						removed.push(id)
					},
				},
				isRunning: async () => testCase.running,
			})
			expect(removed).toEqual(testCase.expectedRemoved ? ['a'] : [])
		})
	}
})
