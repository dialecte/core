import { SqliteStore } from './sqlite-store'

import { describe, expect, it } from 'vitest'

import { importDocument } from '@/project/io/import-document'
import { DIALECTE_TEST_NAMESPACES, TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
const NS = DIALECTE_TEST_NAMESPACES

function xmlFile(body: string): File {
	return new File([`<Root xmlns="${NS.default.uri}">${body}</Root>`], 'doc.xml', {
		type: 'application/xml',
	})
}

describe('SQLite store — end-to-end import (memory mode)', () => {
	it('imports XML through the full pipeline into SQLite (begin/bulkWrite/finalize)', async () => {
		const store = new SqliteStore('proj', {
			recordSchema: CONFIG.database.recordSchema,
			mode: 'memory',
		})
		await store.open()

		const { documentId, recordCount } = await importDocument({
			file: xmlFile('<A><AA_1/></A><B/>'),
			store,
			configs: { default: CONFIG },
			defaultConfigKey: 'default',
		})

		// Root + A + AA_1 + B = 4 records, landed in the SQLite record table.
		expect(recordCount).toBe(4)
		const records = await store.getByDocumentId(documentId)
		expect(records).toHaveLength(4)

		const a = records.find((r) => r.tagName === 'A')!
		const aa1 = records.find((r) => r.tagName === 'AA_1')!
		expect(aa1.parent).toEqual({ id: a.id, tagName: 'A' })
		expect(a.children).toContainEqual(expect.objectContaining({ id: aa1.id, tagName: 'AA_1' }))

		await store.close()
	})

	it('rolls the document back if parsing fails', async () => {
		const store = new SqliteStore('proj2', {
			recordSchema: CONFIG.database.recordSchema,
			mode: 'memory',
		})
		await store.open()

		await expect(
			importDocument({
				file: new File(['not xml'], 'bad.txt'),
				store,
				configs: { default: CONFIG },
				defaultConfigKey: 'default',
			}),
		).rejects.toBeTruthy()

		// No document left registered after the failed import.
		expect(await store.getDocuments()).toHaveLength(0)
		await store.close()
	})
})
