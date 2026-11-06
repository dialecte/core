import { Project } from '@/project'

import type { CreateDialecteProjectParams } from './dialecte.types'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig } from '@/types'

/**
 * The one place a Project of a declared dialecte is wired: every config, the default key, the
 * dialecte's extensions under the consumer's, a fresh hooks instance, the local store by default.
 */
export function createDialecteProject<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	CustomModules extends ExtensionModules = Record<never, never>,
>(
	params: CreateDialecteProjectParams<GenericConfig, GenericModules, CustomModules>,
): Project<GenericConfig, GenericModules & CustomModules> {
	const { dialecte, storage = { type: 'local' }, extensions, dev } = params
	return new Project<GenericConfig, GenericModules & CustomModules>({
		configs: dialecte.configs,
		defaultConfigKey: dialecte.defaultConfigKey,
		storage,
		extensions: { base: dialecte.extensions, custom: extensions },
		hooks: dialecte.createHooks(),
		dev,
		dialecteId: dialecte.id,
		dialecteVersion: dialecte.version,
	})
}
