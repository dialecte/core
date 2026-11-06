import { createDialecteProject } from './create-dialecte-project'

import { resolveStore } from '@/store/resolve-store'

import type {
	CreateProjectFactoryParams,
	CreateProjectParams,
	ProjectFactory,
} from './dialecte.types'
import type { ExtensionModules } from '@/document'
import type { Project, StorageParam } from '@/project'
import type { AnyDialecteConfig } from '@/types'

/**
 * The project factory of a dialecte: every config, the default key, the dialecte's extensions
 * merged under the consumer's, and a fresh hooks instance per Project. It carries the declaration and names no store:
 * each Project it makes opens on the `storage` given to it, core's own or a kind an entry registers (SQLite storage
 * with `@dialecte/core/sqlite`, whose page tells once where its engine worker is). `destroyProject({ name, storage })`
 * deletes the dialecte's project of that name on that storage without opening it (one a store cannot open too).
 *
 * @intent open projects of a dialecte from an app, get the factory that creates a dialecte's projects, delete a dialecte's project without opening it, use SQLite storage in an app (register the app's engine with `registerSqliteEngine` from `@dialecte/core/sqlite` and open with `storage: { type: 'sqlite' }`), share one SQLite engine per project between the tabs of an app
 */
export function createProjectFactory<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: CreateProjectFactoryParams<GenericConfig, GenericModules, GenericConfigKey>,
): ProjectFactory<GenericConfig, GenericModules, GenericConfigKey> {
	const { dialecte } = params

	function createProject<CustomModules extends ExtensionModules = Record<never, never>>(
		createParams?: CreateProjectParams<CustomModules>,
	): Project<GenericConfig, GenericModules & CustomModules> {
		return createDialecteProject<GenericConfig, GenericModules, CustomModules>({
			...createParams,
			dialecte,
		})
	}

	/**
	 * The dialecte's project of that name on `storage` deleted, never opened: the store of that kind is resolved for the
	 * dialecte as a Project's open would, then destroyed. Refused as that store refuses a destroy (another connection
	 * holding the project, a browser giving no storage for it); a type no kind is registered for in this realm is
	 * refused `PROJECT_STORAGE_NOT_REGISTERED`, nothing deleted.
	 */
	async function destroyProject(destroyParams: {
		name: string
		storage: StorageParam
	}): Promise<void> {
		const { name, storage } = destroyParams
		const store = resolveStore({
			name,
			dialecteId: dialecte.id,
			storage,
			runtime: {
				configs: dialecte.configs as Record<string, AnyDialecteConfig>,
				defaultConfigKey: dialecte.defaultConfigKey,
				dialecteVersion: dialecte.version,
			},
		})
		await store.destroy()
	}

	return Object.assign(createProject, { dialecte, destroyProject })
}
