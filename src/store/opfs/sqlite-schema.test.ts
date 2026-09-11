import {
	recordIdIndexDDL,
	recordIdIndexDropDDL,
	recordIndexDDL,
	recordTableDDL,
} from './sqlite-schema'

import { describe, expect, it } from 'vitest'

import type { RecordSchema } from '../store.types'

// The production SCL record schema (see src/test/config.ts): scalar + compound + multiEntry.
const SCL_SCHEMA: RecordSchema = {
	primaryKey: 'id',
	indexes: ['tagName', 'parent.id', 'parent.tagName'],
	compoundIndexes: [['id', 'tagName']],
	arrayIndexes: ['children.id', 'children.tagName'],
}

describe('sqlite-schema', () => {
	describe('recordTableDDL', () => {
		it('creates a plain rowid record table (id not the PK) with split namespace, no children', () => {
			const ddl = recordTableDDL('xel_doc1')
			expect(ddl).toContain('"xel_doc1"')
			expect(ddl).toMatch(/id\s+TEXT/i)
			// id is NOT the primary key: the unique index is deferred to finalize (bulk build).
			expect(ddl).not.toMatch(/PRIMARY KEY/i)
			for (const col of [
				'tagName',
				'nsPrefix',
				'nsUri',
				'value',
				'parentId',
				'parentTagName',
				'attributes',
			]) {
				expect(ddl).toContain(col)
			}
			// `children` is derived from `parentId`, never stored.
			expect(ddl).not.toContain('children')
		})
	})

	describe('recordIdIndexDDL', () => {
		it('builds a UNIQUE index on id, and a matching drop for the bulk-load window', () => {
			expect(recordIdIndexDDL('xel_doc1')).toMatch(
				/CREATE UNIQUE INDEX IF NOT EXISTS "idx_xel_doc1_id" ON "xel_doc1"\("id"\)/,
			)
			expect(recordIdIndexDropDDL('xel_doc1')).toMatch(/DROP INDEX IF EXISTS "idx_xel_doc1_id"/)
		})
	})

	describe('recordIndexDDL', () => {
		it('indexes tagName + denormalized parentId/parentTagName + the [id,tagName] compound', () => {
			const stmts = recordIndexDDL('xel_doc1', SCL_SCHEMA).join('\n')
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("tagName"\)/)
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("parentId"\)/)
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("parentTagName"\)/)
			expect(stmts).toMatch(/\("id","tagName"\)/)
			// The deferred id unique index is part of the finalize-time build set.
			expect(stmts).toMatch(/UNIQUE INDEX IF NOT EXISTS "idx_xel_doc1_id"/)
		})

		it('DROPS the multiEntry children.* indexes (no read path uses them)', () => {
			const stmts = recordIndexDDL('xel_doc1', SCL_SCHEMA).join('\n')
			expect(stmts).not.toContain('children')
		})
	})
})
