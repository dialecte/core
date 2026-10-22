import { createDialecteProject } from './create-dialecte-project'

import type {
	CreateProjectFactoryParams,
	CreateProjectParams,
	ProjectFactory,
} from './dialecte.types'
import type { ExtensionModules } from '@/document'
import type { Project } from '@/project'
import type { AnyDialecteConfig } from '@/types'

/**
 * The project factory of a dialecte: every config, the default key, the dialecte's extensions
 * merged under the consumer's, and a fresh hooks instance per Project. It carries the declaration
 * and `engineUrl`, the address of the dialecte's engine worker, for the store that spawns it.
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
		})
	}

	return Object.assign(createProject, { dialecte, engineUrl })
}
