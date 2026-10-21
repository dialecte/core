import { invariant } from '@/utils'

import type { ResolveConfigParams, ResolvedConfig } from '../types'

/** The config a document is imported or created with: the key given, or the project's default. */
export function resolveConfig(params: ResolveConfigParams): ResolvedConfig {
	const { configs, defaultConfigKey, configKey = defaultConfigKey } = params
	const config = configs[configKey]

	invariant(config, {
		key: 'UNKNOWN_CONFIG_KEY',
		detail: `Unknown configKey: "${configKey}". Available: ${Object.keys(configs).join(', ')}`,
	})

	return { configKey, config }
}
