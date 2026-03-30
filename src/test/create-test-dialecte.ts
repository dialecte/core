import { createXmlAssertions } from './assert-xml'
import { TEST_DIALECTE_CONFIG } from './config'

import { openDialecteDocument } from '@/dialecte'
import { importXmlFiles, exportXmlFile } from '@/io'
import { DexieStore } from '@/store'

import type { Context } from '@/document'
import type { Document } from '@/document'
import type { AnyDialecteConfig } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

/**
 * Create a Document instance from an XML string for testing.
 * Imports the XML into an IndexedDB database and returns a configured Document.
 */
export async function createTestDialecte<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
>(params: {
	xmlString: string
	dialecteConfig?: GenericConfig
}): Promise<{
	document: Document<GenericConfig>
	databaseName: string
	cleanup: () => Promise<void>
	exportCurrentTest: (params?: {
		extension?: GenericConfig['io']['supportedFileExtensions'][number]
		withDatabaseIds?: boolean
	}) => Promise<{ xmlDocument: XMLDocument; filename: string }>
}> {
	const { xmlString, dialecteConfig = TEST_DIALECTE_CONFIG } = params

	const filename = `test-${crypto.randomUUID()}.xml`
	const file = new File([xmlString], filename, { type: 'text/xml' })

	const databaseNames = await importXmlFiles({
		files: [file],
		dialecteConfig,
		useCustomRecordsIds: true,
	})

	const databaseName = databaseNames[0]

	const document = openDialecteDocument({
		config: dialecteConfig as GenericConfig,
		storage: { type: 'local', databaseName },
	})

	//== Callbacks

	const exportCurrentTest = async (params?: {
		extension?: GenericConfig['io']['supportedFileExtensions'][number]
		withDatabaseIds?: boolean
	}) => {
		const { extension = dialecteConfig.io.supportedFileExtensions[0], withDatabaseIds = false } =
			params || {}

		return exportXmlFile({
			dialecteConfig: dialecteConfig as GenericConfig,
			databaseName,
			extension,
			withDatabaseIds,
		})
	}

	const cleanup = async () => {
		document.destroy()
	}

	return {
		document,
		databaseName,
		exportCurrentTest,
		cleanup,
	}
}

/**
 * Create a Context directly from a databaseName for testing FP query functions.
 * The store is not pre-opened — call store.open() before use if needed,
 * or use DexieStore which opens lazily on first query.
 */
export function createTestContext<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
}): Context<GenericConfig> {
	const { databaseName, dialecteConfig } = params
	return {
		store: new DexieStore(databaseName, dialecteConfig),
		recordCache: new Map(),
		stagedOperations: [],
	}
}
