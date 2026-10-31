import { fileURLToPath } from 'node:url'

import viteConfig from '../../vite.config'
import { TEST_ENTRY_BUNDLE_TIMEOUT_MS } from './test-timing.constants'

import { build } from 'vite'
import { describe, expect, it } from 'vitest'

import type { Rollup } from 'vite'

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** A module of vitest or one of its own packages (@vitest/runner...): bundled into the output instead of imported. */
const VITEST_MODULE = /node_modules\/(@vitest|vitest)\//

/**
 * An import of vitest or of one of its sub-paths: the test entry imports only the bare `vitest` (a sub-path
 * such as the deprecated `vitest/suite` prints a deprecation line in every consumer's run).
 */
const VITEST_ID = /^(@vitest\/|vitest(\/|$))/

/** The test entry built with the package's own build settings (its externals), kept in memory. */
async function buildTestEntry(): Promise<Rollup.OutputChunk[]> {
	const output = await build({
		...viteConfig,
		configFile: false,
		root: PACKAGE_ROOT,
		logLevel: 'silent',
		// none of the config's plugins: shipTestSchemas' closeBundle writes dist/test/xsd even with write: false
		plugins: [],
		build: {
			...viteConfig.build,
			write: false,
			lib: {
				entry: { test: fileURLToPath(new URL('./index.ts', import.meta.url)) },
				formats: ['es'],
			},
		},
	})
	const outputs = Array.isArray(output) ? output : [output]
	return outputs
		.flatMap((result) => ('output' in result ? result.output : []))
		.filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
}

describe('the built test entry', () => {
	it(
		'imports vitest from the consumer, only by its bare id, never bundles a copy of it',
		async () => {
			const chunks = await buildTestEntry()

			expect({
				vitestImports: [
					...new Set(
						chunks.flatMap((chunk) =>
							[...chunk.imports, ...chunk.dynamicImports].filter((id) => VITEST_ID.test(id)),
						),
					),
				],
				bundlesVitest: chunks.flatMap((chunk) =>
					chunk.moduleIds.filter((moduleId) => VITEST_MODULE.test(moduleId)),
				),
			}).toEqual({ vitestImports: ['vitest'], bundlesVitest: [] })
		},
		TEST_ENTRY_BUNDLE_TIMEOUT_MS,
	)
})
