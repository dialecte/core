import type { DialecteDeclaration } from '@/dialecte'
import type { ExtensionModules } from '@/document'
import type { StorageParam } from '@/project'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/** What a test project is built from: a declaration, and the consumer's own modules when given. */
export type TestDialecteSetup<GenericConfig extends AnyDialecteConfig> = {
	dialecte: DialecteDeclaration<GenericConfig, ExtensionModules, string>
	custom?: ExtensionModules
}

/** What a runner holds for every case: the dialecte setup and the store the projects run on. */
export type RunnerSetup<GenericConfig extends AnyDialecteConfig> = {
	setup: TestDialecteSetup<GenericConfig>
	storage?: StorageParam
}

/** What one `withExport` / `withoutExport` call may put in place of the runner's. */
export type CaseOverrides<GenericConfig extends AnyDialecteConfig> = {
	configKey?: string
	dialecteConfig?: GenericConfig
	hooks?: DialecteHooks<GenericConfig>
	dev?: { perf?: boolean }
}

/** A config of the setup by its key; the default config when no key is given. */
export type ResolveTestConfigParams<GenericConfig extends AnyDialecteConfig> = {
	setup: TestDialecteSetup<GenericConfig>
	configKey: string | undefined
}
