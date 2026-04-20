import type { StorageOptions } from '@/store'
import type { AnyDialecteConfig, ExtensionModules, TransactionHooks } from '@/types'

export type OpenParams<
	GenericConfig extends AnyDialecteConfig,
	BaseExtensions extends ExtensionModules,
	CustomExtensions extends ExtensionModules,
> = {
	config: GenericConfig
	storage: StorageOptions
	extensions?: { base?: BaseExtensions; custom?: CustomExtensions }
	hooks?: TransactionHooks<GenericConfig>
}
