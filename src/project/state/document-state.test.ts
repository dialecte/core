import { buildDocumentState, reconcileDocumentState } from './document-state'

import { describe, it, expect } from 'vitest'

import type { DocumentRecord } from '@/types'
import type { DocumentState } from '@/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
	return {
		id: overrides.id ?? crypto.randomUUID(),
		name: overrides.name ?? 'untitled',
		extension: overrides.extension ?? '.scd',
		configKey: overrides.configKey ?? 'scl',
		createdAt: overrides.createdAt ?? Date.now(),
		metadata: overrides.metadata,
	}
}

// ── buildDocumentState ───────────────────────────────────────────────────────────

describe('buildDocumentState', () => {
	const cases: Record<string, { input: DocumentRecord; expected: Partial<DocumentState> }> = {
		'minimal file -> default state': {
			input: makeFile({ id: 'file-1', name: 'test' }),
			expected: {
				loading: false,
				error: null,
				progress: null,
				history: [],
				lastUpdate: null,
				canUndo: false,
				canRedo: false,
			},
		},
		'file with metadata -> preserves file reference': {
			input: makeFile({ id: 'file-2', metadata: { source: 'import' } }),
			expected: {
				loading: false,
				error: null,
			},
		},
	}

	it.each(Object.entries(cases))('%s', (_label, { input, expected }) => {
		const result = buildDocumentState(input)

		expect(result.document).toBe(input)
		expect(result).toMatchObject(expected)
	})
})

// ── reconcileDocumentState ───────────────────────────────────────────────────────

describe('reconcileDocumentState', () => {
	const fileA = makeFile({ id: 'a' })
	const fileB = makeFile({ id: 'b' })
	const fileC = makeFile({ id: 'c' })

	const cases: Record<
		string,
		{
			initial: DocumentRecord[]
			storeDocuments: DocumentRecord[]
			expectedIds: string[]
		}
	> = {
		'empty state + new files -> adds all': {
			initial: [],
			storeDocuments: [fileA, fileB],
			expectedIds: ['a', 'b'],
		},
		'existing state + no store files -> removes all': {
			initial: [fileA, fileB],
			storeDocuments: [],
			expectedIds: [],
		},
		'adds new + keeps existing': {
			initial: [fileA],
			storeDocuments: [fileA, fileB, fileC],
			expectedIds: ['a', 'b', 'c'],
		},
		'removes stale + keeps matching': {
			initial: [fileA, fileB, fileC],
			storeDocuments: [fileB],
			expectedIds: ['b'],
		},
		'no-op when identical': {
			initial: [fileA, fileB],
			storeDocuments: [fileA, fileB],
			expectedIds: ['a', 'b'],
		},
	}

	it.each(Object.entries(cases))('%s', (_label, { initial, storeDocuments, expectedIds }) => {
		const state = new Map<string, DocumentState>()
		for (const file of initial) {
			state.set(file.id, buildDocumentState(file))
		}

		const result = reconcileDocumentState(state, storeDocuments)

		expect([...result.keys()].sort()).toEqual(expectedIds.sort())
	})

	it('preserves existing DocumentState references for unchanged files', () => {
		const state = new Map<string, DocumentState>()
		const existingState = buildDocumentState(fileA)
		state.set('a', existingState)

		reconcileDocumentState(state, [fileA, fileB])

		expect(state.get('a')).toBe(existingState)
	})
})
