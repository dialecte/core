import { fileURLToPath } from 'node:url'

import viteConfig from './vite.config'

import { playwright } from '@vitest/browser-playwright'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'

import type { BrowserConfigOptions } from 'vitest/node'

const root = fileURLToPath(new URL('./', import.meta.url))
const createBrowser = (): BrowserConfigOptions => ({
	provider: playwright(),
	enabled: true,
	headless: true,
	instances: [{ browser: 'chromium' }],
	screenshotFailures: false,
})

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			watch: false,
			testTimeout: 5_000,
			projects: [
				{
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'unit',
						browser: createBrowser(),
						include: ['src/**/*.test.{js,ts,jsx,tsx}'],
						exclude: [...configDefaults.exclude, 'src/**/*.bench.test.{js,ts}'],
						root,
					},
				},
				{
					resolve: viteConfig.resolve,
					plugins: [],
					test: {
						name: 'perf',
						testTimeout: 180_000,
						browser: createBrowser(),
						include: ['src/**/*.bench.test.{js,ts}'],
						root,
					},
				},
			],
		},
	}),
)
