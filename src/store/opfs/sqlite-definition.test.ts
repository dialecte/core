import { SqliteStore } from './sqlite-store'

import { describe, expect, it } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE } from '@/test'

import type { AnyDialecteConfig } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

// Runtime URL the engine loads by specifier (as the worker will `import()` scl's definition).
const DEFINITION_URL = new URL('./fixtures/stamp-definition.ts', import.meta.url).href

const XML = `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}><A ${CUSTOM_RECORD_ID_ATTRIBUTE}="a1" aA="parent" /></Root>`

describe('SqliteStore — definition hooks run inside the engine realm', () => {
	it('loads createHooks via definitionSpecifier and runs them during importDocument', async () => {
		const store = new SqliteStore(`def-${crypto.randomUUID()}`, {
			recordSchema: CONFIG.database.recordSchema,
			mode: 'memory',
			definitionSpecifier: DEFINITION_URL,
		})
		await store.open()
		const documentId = crypto.randomUUID()
		await store.registerDocument({
			id: documentId,
			name: 'load',
			extension: '.xml',
			configKey: 'default',
			createdAt: Date.now(),
		})
		const file = new File([XML], 'load.xml', { type: 'text/xml' })

		await store.importDocument(documentId, file, CONFIG, true)

		const records = await store.getByDocumentId(documentId)
		expect(records.length).toBeGreaterThan(0)
		expect(records.every((record) => record.value === 'STAMPED')).toBe(true)

		await store.close()
	})

	it('loads the definition inside the real worker realm (opfs-sahpool)', async () => {
		const store = new SqliteStore(`def-${crypto.randomUUID()}`, {
			recordSchema: CONFIG.database.recordSchema,
			mode: 'opfs-sahpool',
			definitionSpecifier: DEFINITION_URL,
		})
		await store.open()
		const documentId = crypto.randomUUID()
		await store.registerDocument({
			id: documentId,
			name: 'load',
			extension: '.xml',
			configKey: 'default',
			createdAt: Date.now(),
		})
		const file = new File([XML], 'load.xml', { type: 'text/xml' })

		await store.importDocument(documentId, file, CONFIG, true)

		const records = await store.getByDocumentId(documentId)
		expect(records.length).toBeGreaterThan(0)
		expect(records.every((record) => record.value === 'STAMPED')).toBe(true)

		await store.destroy()
	})
})
