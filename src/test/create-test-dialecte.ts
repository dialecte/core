import { TEST_DIALECTE_CONFIG } from './config'

import { Project } from '@/project'
import { DexieStore } from '@/store'

import type { Document } from '@/document'
import type { Context } from '@/document'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

export type TestFile<GenericConfig extends AnyDialecteConfig> = {
	documentId: string
	document: Document<GenericConfig>
}

export type TestProjectResult<GenericConfig extends AnyDialecteConfig> = {
	project: Project<GenericConfig>
	source: TestFile<GenericConfig>
	target?: TestFile<GenericConfig>
}

/**
 * Spin up a Project with source (and optionally target) file imported.
 * Returns project + pre-opened documents. Caller owns lifecycle via project.destroy().
 */
export async function createTestProject<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
>(params: {
	sourceXml: string
	targetXml?: string
	dialecteConfig?: GenericConfig
	hooks?: TransactionHooks<GenericConfig>
}): Promise<TestProjectResult<GenericConfig>> {
	const {
		sourceXml,
		targetXml,
		dialecteConfig = TEST_DIALECTE_CONFIG,
		hooks,
	} = params as {
		sourceXml: string
		targetXml?: string
		dialecteConfig: GenericConfig
		hooks?: TransactionHooks<GenericConfig>
	}

	const projectName = `test-${crypto.randomUUID()}`

	const project = await new Project<GenericConfig>({
		configs: { default: dialecteConfig } as Record<string, GenericConfig>,
		defaultConfigKey: 'default',
		storage: { type: 'local' },
		hooks: hooks as TransactionHooks<GenericConfig>,
	}).open(projectName)

	const sourceImport = await project.import(
		new File([sourceXml], 'source.xml', { type: 'text/xml' }),
		{ useCustomRecordsIds: true },
	)
	const source: TestFile<GenericConfig> = {
		documentId: sourceImport.documentId,
		document: project.openDocument(sourceImport.documentId),
	}

	let target: TestFile<GenericConfig> | undefined
	if (targetXml) {
		const targetImport = await project.import(
			new File([targetXml], 'target.xml', { type: 'text/xml' }),
			{ useCustomRecordsIds: true },
		)
		target = {
			documentId: targetImport.documentId,
			document: project.openDocument(targetImport.documentId),
		}
	}

	return { project, source, target }
}

/**
 * Create a Context directly from a databaseName for testing FP query functions.
 * Opens the store to discover existing tables.
 */
export async function createTestContext<GenericConfig extends AnyDialecteConfig>(params: {
	databaseName: string
	dialecteConfig: GenericConfig
	documentId: string
}): Promise<Context<GenericConfig>> {
	const { databaseName, dialecteConfig, documentId } = params
	const store = new DexieStore(databaseName, {
		recordSchema: dialecteConfig.database.recordSchema,
	})
	await store.open()
	return {
		dialecteConfig,
		store,
		documentId,
		recordCache: new Map(),
		stagedOperations: [],
	}
}
