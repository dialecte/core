import type { DialecteDeclaration } from '@/dialecte'
import type { Document, ExtensionModules, MergedExtensions } from '@/document'
import type { Project, StorageParam } from '@/project'
import type { Store } from '@/store'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

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

/** The dialecte as declared: every config, the default key, its extensions, fresh hooks per project. */
export type DeclaredTestDialecteParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = {
	dialecte: DialecteDeclaration<GenericConfig, GenericModules, GenericConfigKey>
}

/** The dialecte in parts: one config under the key `default`, extensions, one hooks instance. */
export type LegacyTestDialecteParams<GenericConfig extends AnyDialecteConfig> = {
	dialecte?: never
	/**
	 * Defaults to core's own test config.
	 * @deprecated Declare the dialecte with `defineDialecte` and pass it as `dialecte`.
	 */
	dialecteConfig?: GenericConfig
	/** @deprecated The declaration's `extensions`. */
	extensions?: { base?: ExtensionModules; custom?: ExtensionModules }
	/**
	 * Shared by every project built from these parts.
	 * @deprecated The declaration's `createHooks`.
	 */
	hooks?: DialecteHooks<GenericConfig>
}

/** `createTestProject` on a declaration; without one, core's own test dialecte. */
export type DeclaredTestProjectParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = TestProjectOptions &
	Partial<DeclaredTestDialecteParams<GenericConfig, GenericModules, GenericConfigKey>>

/** `createTestProject` on a dialecte given in parts. */
export type LegacyTestProjectParams<GenericConfig extends AnyDialecteConfig> = TestProjectOptions &
	LegacyTestDialecteParams<GenericConfig>

/** `createTestRunner` on a declaration. */
export type DeclaredTestRunnerParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = DeclaredTestDialecteParams<GenericConfig, GenericModules, GenericConfigKey> & {
	/** The store the test projects run on. Defaults to the local store. */
	storage?: StorageParam
}

/** `createTestRunner` on a dialecte given in parts. */
export type LegacyTestRunnerParams<GenericConfig extends AnyDialecteConfig> =
	LegacyTestDialecteParams<GenericConfig> & {
		dialecteConfig: GenericConfig
		/** The store the test projects run on. Defaults to the local store. */
		storage?: StorageParam
	}

/** `createTestContext`: the store to read, or the project to open by its name and dialecte. */
export type TestContextParams<GenericConfig extends AnyDialecteConfig> = {
	dialecteConfig: GenericConfig
	documentId: string
} & (
	| { store: Store; databaseName?: undefined; dialecteId?: undefined; storage?: undefined }
	| {
			databaseName: string
			/**
			 * The dialecte of the project named, as the project says it (`project.dialecteId`): with the name, which
			 * project the in-memory store holds. `undefined` for a project made with no dialecte.
			 */
			dialecteId: string | undefined
			/** The store of the project named; the local store when absent. */
			storage?: StorageParam
			store?: undefined
	  }
)

export type TestProjectOptions = {
	sourceXml: string
	targetXml?: string
	/** The declared config the source and target are imported under. Defaults to the default key. */
	configKey?: string
	/** The store the test project runs on. Defaults to the local store. */
	storage?: StorageParam
	/** Project dev options; `perf: true` makes `document.perf.report()` count the store reads. */
	dev?: { perf?: boolean }
}
