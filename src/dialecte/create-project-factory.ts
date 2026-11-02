import { createDialecteProject } from './create-dialecte-project'

import { resolveStore } from '@/store/resolve-store'

import type {
	CreateProjectFactoryParams,
	CreateProjectParams,
	ProjectFactory,
} from './dialecte.types'
import type { ExtensionModules } from '@/document'
import type { Project } from '@/project'
import type { HubEngineSpawner } from '@/store'
import type { AnyDialecteConfig } from '@/types'

/**
 * The project factory of a dialecte: every config, the default key, the dialecte's extensions
 * merged under the consumer's, and a fresh hooks instance per Project. It carries the declaration,
 * `engineUrl`, the address of the dialecte's engine worker, for the store that spawns it, and `spawner`,
 * the engine as a page registers it with the hub (`connectHub({ spawners })`). `destroyProject({ name })` deletes the
 * dialecte's project of that name on SQLite storage without opening it (an outdated or lost one too).
 *
 * @intent open projects of a dialecte from an app, get the factory that creates a dialecte's projects, delete a dialecte's project without opening it, register a dialecte's engine with the hub, use SQLite storage in an app (import `@dialecte/core/sqlite` once and open with `storage: { type: 'sqlite' }`), share one SQLite engine per project between the tabs of an app
 */
export function createProjectFactory<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: CreateProjectFactoryParams<GenericConfig, GenericModules, GenericConfigKey>,
): ProjectFactory<GenericConfig, GenericModules, GenericConfigKey> {
	const { dialecte, engineUrl } = params

	function createProject<CustomModules extends ExtensionModules = Record<never, never>>(
		createParams?: CreateProjectParams<CustomModules>,
	): Project<GenericConfig, GenericModules & CustomModules> {
		return createDialecteProject<GenericConfig, GenericModules, CustomModules>({
			...createParams,
			dialecte,
			engineUrl,
		})
	}

	const spawner: HubEngineSpawner = {
		dialecteId: dialecte.id,
		dialecteVersion: dialecte.version,
		engineUrl,
	}
	/**
	 * The dialecte's project of that name on SQLite storage deleted, never opened (one of another layout, or whose
	 * database is lost, too): through the page's hub when it has one, else by the page; refused `PROJECT_OPEN_ELSEWHERE`
	 * while a view has it open, `STORE_UNAVAILABLE` where the browser gives no private file system - but in a child bound
	 * through `adoptHubPort`, deleted by a view of the origin that can store.
	 */
	async function destroyProject(destroyParams: { name: string }): Promise<void> {
		const { name } = destroyParams
		const store = resolveStore({
			name,
			dialecteId: dialecte.id,
			storage: { type: 'sqlite' },
			runtime: {
				configs: dialecte.configs as Record<string, AnyDialecteConfig>,
				defaultConfigKey: dialecte.defaultConfigKey,
				dialecteVersion: dialecte.version,
				engineUrl,
			},
		})
		await store.destroy()
	}

	return Object.assign(createProject, { dialecte, engineUrl, spawner, destroyProject })
}
