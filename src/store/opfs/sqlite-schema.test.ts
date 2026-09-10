import { recordIndexDDL, recordTableDDL } from './sqlite-schema'

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
		it('creates the record table with id primary key + split namespace, no children column', () => {
			const ddl = recordTableDDL('xel_doc1')
			expect(ddl).toContain('"xel_doc1"')
			expect(ddl).toMatch(/id\s+TEXT\s+PRIMARY KEY/i)
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

	describe('recordIndexDDL', () => {
		it('indexes tagName + denormalized parentId/parentTagName + the [id,tagName] compound', () => {
			const stmts = recordIndexDDL('xel_doc1', SCL_SCHEMA).join('\n')
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("tagName"\)/)
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("parentId"\)/)
			expect(stmts).toMatch(/ON\s+"xel_doc1"\("parentTagName"\)/)
			expect(stmts).toMatch(/\("id","tagName"\)/)
		})

		it('DROPS the multiEntry children.* indexes (no read path uses them)', () => {
			const stmts = recordIndexDDL('xel_doc1', SCL_SCHEMA).join('\n')
			expect(stmts).not.toContain('children')
		})
	})
})
