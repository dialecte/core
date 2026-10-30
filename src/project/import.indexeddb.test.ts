import { xmlFile } from './import.fixtures'
import { Project } from './project'

import { describe, expect, it } from 'vitest'

import { TABLE_DOCUMENTS } from '@/store/store.constants'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'
import type Dexie from 'dexie'

// An import refused on the local store: IndexedDB keeps neither the document's row nor its record table.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

describe('Project.importFile on IndexedDB', () => {
	it('on IndexedDB: a malformed file → PARSE_ERROR, no row, no record table', async () => {
		const project = await new Project({
			configs: { default: CONFIG },
			storage: { type: 'local' },
		}).open(`import-${crypto.randomUUID()}`)
		try {
			const broken = xmlFile({ body: '<A>', name: 'broken.xml' })
			await expect(project.importFile(broken)).rejects.toMatchObject({
				cause: { key: 'PARSE_ERROR' },
			})
			const documents = await project.getDocuments()
			expect(documents).toEqual([])
			expect([...project.state.documents.keys()]).toEqual([])
			const dexie = project.getDatabaseInstance() as Dexie
			const documentRows = await dexie.table(TABLE_DOCUMENTS).toArray()
			expect(documentRows).toEqual([])
			const tableNames = dexie.tables.map((table) => table.name)
			expect(tableNames.filter((name) => name.startsWith('xel_'))).toEqual([])
		} finally {
			await project.destroy()
		}
	})
})
