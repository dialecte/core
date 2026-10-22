import { NO_EXTENSION_MODULES } from './dialecte.constants'

import { createDialecteError } from '@/errors'

import type { DefineDialecteParams, DialecteDeclaration } from './dialecte.types'
import type { ExtensionModules } from '@/document'
import type { AnyDialecteConfig } from '@/types'

function createNoHooks(): Record<never, never> {
	return {}
}

/**
 * Declare a dialecte once: its identity, its configs, its extensions and how its hooks are made.
 * Core derives the rest: `createProjectFactory`, `createTestRunner`, `createTestProject` and,
 * in a worker, the engine. The declaration is frozen.
 */
export function defineDialecte<
	GenericConfig extends AnyDialecteConfig,
	GenericModules extends ExtensionModules = Record<never, never>,
	GenericConfigKey extends string = string,
>(
	params: DefineDialecteParams<GenericConfig, GenericModules, GenericConfigKey>,
): DialecteDeclaration<GenericConfig, GenericModules, GenericConfigKey> {
	const { id, version, configs, defaultConfigKey, extensions, createHooks } = params

	if (!Object.hasOwn(configs, defaultConfigKey)) {
		throw createDialecteError('UNKNOWN_CONFIG_KEY', {
			detail: `Dialecte "${id}" names "${defaultConfigKey}" as its default config, which is none of its configs: ${Object.keys(configs).join(', ') || '(none)'}.`,
			meta: { id, defaultConfigKey, configKeys: Object.keys(configs) },
		})
	}

	return Object.freeze({
		id,
		version,
		configs,
		defaultConfigKey,
		// A caller may name GenericModules without declaring any module: the empty record is its value.
		extensions: extensions ?? (NO_EXTENSION_MODULES as GenericModules),
		createHooks: createHooks ?? createNoHooks,
	})
}
