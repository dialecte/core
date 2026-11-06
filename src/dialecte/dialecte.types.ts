import type { ExtensionModules } from '@/document'
import type { Project, StorageParam } from '@/project'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

/** What a dialecte gives `defineDialecte`: everything core derives a Project, a test runner and a store's runtime from. */
export type DefineDialecteParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = {
	/** The dialecte's identity: a store keeps it with each project, so two dialectes' projects of one name stay apart. */
	id: string
	/** The dialecte package's version: a view and a store that runs the dialecte elsewhere must run the same one. */
	version: string
	/** Every config of the dialecte, under the keys `configKey` names them by. */
	configs: Record<GenericConfigKey, GenericConfig>
	/** The config a document gets when it names none. */
	defaultConfigKey: NoInfer<GenericConfigKey>
	/** The dialecte's own extension modules, merged under the ones a consumer adds per project. */
	extensions?: GenericModules
	/**
	 * Makes the dialecte's hooks (IO and transaction). Called once per Project and once per store that runs the dialecte
	 * elsewhere: the state a hook keeps belongs to that one owner, never shared across realms.
	 */
	createHooks?: () => DialecteHooks<GenericConfig>
}

/** A dialecte, declared once: what `defineDialecte` returns and every derivation takes. */
export type DialecteDeclaration<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = {
	readonly id: string
	readonly version: string
	readonly configs: Readonly<Record<GenericConfigKey, GenericConfig>>
	readonly defaultConfigKey: GenericConfigKey
	readonly extensions: GenericModules
	readonly createHooks: () => DialecteHooks<GenericConfig>
}

export type CreateProjectFactoryParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = {
	dialecte: DialecteDeclaration<GenericConfig, GenericModules, GenericConfigKey>
}

/** What a consumer chooses per project; everything else comes from the declaration. */
export type CreateProjectParams<CustomModules extends ExtensionModules = Record<never, never>> = {
	/** Defaults to the local store. */
	storage?: StorageParam
	/** The consumer's own extension modules, merged over the dialecte's. */
	extensions?: CustomModules
	dev?: { perf?: boolean }
}

/** Makes a Project of the dialecte: call it, then `open(name)`. Carries the declaration it was made with. */
export type ProjectFactory<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
> = {
	<CustomModules extends ExtensionModules = Record<never, never>>(
		params?: CreateProjectParams<CustomModules>,
	): Project<GenericConfig, GenericModules & CustomModules>
	readonly dialecte: DialecteDeclaration<GenericConfig, GenericModules, GenericConfigKey>
	/**
	 * Delete the dialecte's project of that name on `storage` without opening it - any kind, core's own or a
	 * registered one (on SQLite, an `outdated` or `lost` project of `listProjects` too); refused
	 * `PROJECT_OPEN_ELSEWHERE` while another connection has it open, `PROJECT_STORAGE_NOT_REGISTERED` on a type no
	 * kind is registered for.
	 */
	readonly destroyProject: (params: { name: string; storage: StorageParam }) => Promise<void>
}

/** What every Project of a dialecte is made from: the declaration and what one consumer chooses. */
export type CreateDialecteProjectParams<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	CustomModules extends ExtensionModules = Record<never, never>,
> = CreateProjectParams<CustomModules> & {
	dialecte: DialecteDeclaration<GenericConfig, GenericModules, string>
}
