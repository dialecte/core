import { TEST_DIALECTE_CONFIG } from './config'

import { Project } from '@/project'
import { DexieStore } from '@/store'

import type { Document } from '@/document'
import type { Context, ExtensionModules, MergedExtensions } from '@/document'
import type { AnyDialecteConfig, TransactionHooks } from '@/types'

type TestDialecteConfig = typeof TEST_DIALECTE_CONFIG

export type TestDocument<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
> = {
	documentId: string
	document: Document<GenericConfig, MergedExtensions<GenericModules>>
}

export type TestProjectResult<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
> = {
	project: Project<GenericConfig, GenericModules>
	source: TestDocument<GenericConfig, GenericModules>
	target?: TestDocument<GenericConfig, GenericModules>
}

/**
 * Spin up a Project with source (and optionally target) file imported.
 * Returns project + pre-opened documents. Caller owns lifecycle via project.destroy().
 */
export async function createTestProject<
	GenericConfig extends AnyDialecteConfig = TestDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
>(params: {
	sourceXml: string
	targetXml?: string
	dialecteConfig?: GenericConfig
	extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
	hooks?: TransactionHooks<GenericConfig>
}): Promise<TestProjectResult<GenericConfig, GenericModules>> {
	const {
		sourceXml,
		targetXml,
		dialecteConfig = TEST_DIALECTE_CONFIG,
		extensions,
		hooks,
	} = params as {
		sourceXml: string
		targetXml?: string
		dialecteConfig: GenericConfig
		extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
		hooks?: TransactionHooks<GenericConfig>
	}

	const projectName = `test-${crypto.randomUUID()}`

	const project = await new Project<GenericConfig, GenericModules>({
		configs: { default: dialecteConfig } as Record<string, GenericConfig>,
		defaultConfigKey: 'default',
		storage: { type: 'local' },
		extensions,
		hooks: hooks as TransactionHooks<GenericConfig>,
	}).open(projectName)

	const [sourceImport] = await project.import(
		[new File([sourceXml], 'source.xml', { type: 'text/xml' })],
		{ useCustomRecordsIds: true },
	)
	const source: TestDocument<GenericConfig, GenericModules> = {
		documentId: sourceImport.documentId,
		document: project.openDocument(sourceImport.documentId),
	}

	let target: TestDocument<GenericConfig, GenericModules> | undefined
	if (targetXml) {
		const [targetImport] = await project.import(
			[new File([targetXml], 'target.xml', { type: 'text/xml' })],
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
