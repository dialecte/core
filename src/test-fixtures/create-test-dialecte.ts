import { TEST_DIALECTE_CONFIG } from './config'

import Dexie from 'dexie'

import { createDialecte } from '@/dialecte'
import { importXmlFiles } from '@/io'

import type { DialecteCore } from '@/dialecte'
import type { AnyDialecteConfig, ExtensionRegistry } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

/**
 * Create SDK instance from XML string for testing
 * Imports the XML into a database and returns configured SDK
 */
export async function createTestDialecte<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericExtensionRegistry extends ExtensionRegistry<GenericConfig> = {},
>(params: {
	xmlString: string
	dialecteConfig?: GenericConfig
	extensions?: GenericExtensionRegistry
}): Promise<{
	dialecte: DialecteCore<GenericConfig, GenericExtensionRegistry>
	databaseName: string
	cleanup: () => Promise<void>
}> {
	const { xmlString, dialecteConfig = TEST_DIALECTE_CONFIG, extensions = {} } = params

	const filename = `test-${crypto.randomUUID()}.xml`
	const file = new File([xmlString], filename, { type: 'text/xml' })

	const databaseNames = await importXmlFiles({
		files: [file],
		dialecteConfig,
		useCustomRecordsIds: true,
	})

	const databaseName = databaseNames[0]

	const dialecte = await createDialecte<GenericConfig, GenericExtensionRegistry>({
		databaseName,
		dialecteConfig: dialecteConfig as GenericConfig,
		extensions: extensions as GenericExtensionRegistry,
	})

	const databaseInstance = dialecte.getDatabaseInstance()
	const cleanup = async () => {
		if (databaseInstance?.isOpen()) {
			databaseInstance.close()
			// Small delay to let IndexedDB fully close before deletion
			await new Promise((resolve) => setTimeout(resolve, 20))
		}
		await Dexie.delete(databaseName)
	}

	return { dialecte, databaseName, cleanup }
}
