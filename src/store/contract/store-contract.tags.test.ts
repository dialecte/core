import { contractTagsOf } from './store-contract.tags'

import { describe, expect, it } from 'vitest'

import type { StoreContractCasePlace, StoreContractTag } from './store-contract.types'

type TagCase = {
	place: StoreContractCasePlace
	tags: StoreContractTag[]
}

const CASES: Record<string, TagCase> = {
	'a second connection: transport': {
		place: {
			table: 'store',
			group: 'one state for every connection',
			description: 'a case',
			needs: ['second-connection'],
		},
		tags: ['transport'],
	},
	'announcements: transport': {
		place: {
			table: 'announce',
			group: 'when a change is told',
			description: 'a case',
			needs: ['announce'],
		},
		tags: ['transport'],
	},
	'an engine ended mid-import: transport': {
		place: {
			table: 'store',
			group: 'importing a file',
			description: 'a case',
			needs: ['engine-end'],
		},
		tags: ['transport'],
	},
	'a view away: transport': {
		place: {
			table: 'store',
			group: 'one state for every connection',
			description: 'a case',
			needs: ['away'],
		},
		tags: ['transport'],
	},
	'another dialecte: transport': {
		place: {
			table: 'store',
			group: 'one state for every connection',
			description: 'a case',
			needs: ['dialecte-key'],
		},
		tags: ['transport'],
	},
	"an import's liveness: transport": {
		place: {
			table: 'store',
			group: 'importing a file',
			description: 'a case',
			needs: ['import-liveness'],
		},
		tags: ['transport'],
	},
	'a full storage: transport': {
		place: {
			table: 'store',
			group: 'a store whose storage is full',
			description: 'a case',
			needs: ['full-storage'],
		},
		tags: ['transport'],
	},
	'an import (its listener and abort cross the port): transport': {
		place: {
			table: 'store',
			group: 'importing a file',
			description: 'a case',
			needs: ['import'],
		},
		tags: ['transport'],
	},
	'an export: transport': {
		place: {
			table: 'export',
			group: 'exporting a document',
			description: 'a case',
			needs: ['export'],
		},
		tags: ['transport'],
	},
	'a transport need after another need (an export after history): transport': {
		place: {
			table: 'export',
			group: 'exporting a document',
			description: 'a case',
			needs: ['history', 'export'],
		},
		tags: ['transport'],
	},
	'an import after history: transport': {
		place: {
			table: 'store',
			group: 'lifecycle',
			description: 'a case',
			needs: ['history', 'import'],
		},
		tags: ['transport'],
	},
	'two transport needs: the tag once': {
		place: {
			table: 'announce',
			group: 'each change told to every connection',
			description: 'a case',
			needs: ['second-connection', 'announce'],
		},
		tags: ['transport'],
	},
	'a transport group and a transport need: the tag once': {
		place: {
			table: 'text',
			group: 'text kept as written',
			description: 'a case',
			needs: ['export'],
		},
		tags: ['transport'],
	},
	'a case listed as reaching a wire member no other transport case calls (blobs attached to nothing): transport':
		{
			place: {
				table: 'store',
				group: 'blobs',
				description: 'getStandaloneBlobs returns the blobs attached to nothing',
				needs: ['blobs'],
			},
			tags: ['transport'],
		},
	'another case of the same group: none': {
		place: {
			table: 'store',
			group: 'blobs',
			description: 'a blob attached to a record',
			needs: ['blobs'],
		},
		tags: [],
	},
	'an import case needing nothing more (an import left unfinished): transport, by its group': {
		place: { table: 'store', group: 'importing a file', description: 'a case' },
		tags: ['transport'],
	},
	'an edit during an import: transport, by its group': {
		place: {
			table: 'store',
			group: 'an edit during an import',
			description: 'a case',
			needs: ['history'],
		},
		tags: ['transport'],
	},
	'an export case, whatever it needs: transport, by its group': {
		place: { table: 'export', group: 'refused exports', description: 'a case' },
		tags: ['transport'],
	},
	'a write during an export: transport, by its group': {
		place: { table: 'export', group: 'a write during an export', description: 'a case' },
		tags: ['transport'],
	},
	'exporting a document: transport, by its group': {
		place: { table: 'export', group: 'exporting a document', description: 'a case' },
		tags: ['transport'],
	},
	'history only: none': {
		place: {
			table: 'store',
			group: 'commit and history',
			description: 'a case',
			needs: ['history'],
		},
		tags: [],
	},
	'blobs and history: none': {
		place: {
			table: 'store',
			group: 'JSON values only',
			description: 'a case',
			needs: ['history', 'blobs'],
		},
		tags: [],
	},
	'no need: none': {
		place: {
			table: 'store',
			group: 'reads',
			description: 'a case',
		},
		tags: [],
	},
	'text kept as written, whatever it needs: transport': {
		place: {
			table: 'text',
			group: 'text kept as written',
			description: 'a case',
			needs: ['history'],
		},
		tags: ['transport'],
	},
	'a character XML does not allow: transport': {
		place: {
			table: 'text',
			group: 'a character XML does not allow is never imported nor exported',
			description: 'a case',
		},
		tags: ['transport'],
	},
	'a key that is not well-formed names nothing (text across the port): transport': {
		place: {
			table: 'text',
			group: 'a key that is not well-formed names nothing',
			description: 'a case',
			needs: ['history'],
		},
		tags: ['transport'],
	},
	'the path table runs in-process only, whatever it needs': {
		place: {
			table: 'path',
			group: 'a document path: registering',
			description: 'a case',
			needs: ['second-connection'],
		},
		tags: [],
	},
	'the well-formed table runs in-process only, whatever it needs': {
		place: {
			table: 'well-formed',
			group: 'text that is not well-formed is refused',
			description: 'a case',
			needs: ['import'],
		},
		tags: [],
	},
}

describe('contractTagsOf', () => {
	for (const [name, testCase] of Object.entries(CASES)) {
		it(name, () => {
			expect(contractTagsOf(testCase.place)).toEqual(testCase.tags)
		})
	}
})
