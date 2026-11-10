import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	BROWSER_ONLY_TEST_FILES,
	NODE_STORE_CONTRACT_TEST_FILES,
	STORE_CONTRACT_LEG_FILES,
} from '../../../vitest.config.constants'
import { FULL_TABLE_VARIABLE } from './store-contract.full-table.constants'

import { describe, expect, it, vi } from 'vitest'

/** The package root: the guard reads the package's own files. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The contract file before it was split per leg. */
const SINGLE_CONTRACT_FILE = 'src/store/contract/store-contract.test.ts'

const LEG_FILES: string[] = Object.values(STORE_CONTRACT_LEG_FILES)

/** The legs whose store runs in the test's own realm: node runs them too. */
const IN_REALM_LEG_FILES: string[] = [
	STORE_CONTRACT_LEG_FILES.inMemory,
	STORE_CONTRACT_LEG_FILES.indexedDb,
	STORE_CONTRACT_LEG_FILES.sqliteInProcess,
]

/** What each leg runs: the legs behind a port run the transport cases, the others the full table. */
const LEG_SUBSETS: Record<keyof typeof STORE_CONTRACT_LEG_FILES, string> = {
	inMemory: 'full',
	indexedDb: 'full',
	sqliteInProcess: 'full',
	sqliteWorker: 'transport',
	sqliteHub: 'transport',
}

/** The full-table variable each project running a leg hands its tests, the config loaded again with `value` set. */
async function fullTableValuesWith(params: {
	value: string
}): Promise<{ name: string; value: string | undefined }[]> {
	vi.stubEnv(FULL_TABLE_VARIABLE, params.value)
	vi.resetModules()
	try {
		const projects = await import('../../../scripts/test-scope/vitest-projects.fixtures').then(
			(fixtures) => fixtures.configuredProjects(),
		)
		return projects
			.filter((project) => ['browser', 'browser-all', 'node-indexeddb'].includes(project.name))
			.map((project) => ({ name: project.name, value: project.env[FULL_TABLE_VARIABLE] }))
	} finally {
		vi.unstubAllEnvs()
		vi.resetModules()
	}
}

/** The full-table value each project running a leg provides its tests (`provide`), the config loaded again with `value` set. */
async function providedFullTableWith(params: {
	value: string
}): Promise<{ name: string; value: unknown }[]> {
	vi.stubEnv(FULL_TABLE_VARIABLE, params.value)
	vi.resetModules()
	try {
		const projects = await import('../../../scripts/test-scope/vitest-projects.fixtures').then(
			(fixtures) => fixtures.configuredProjects(),
		)
		return projects
			.filter((project) => ['browser', 'browser-all', 'node-indexeddb'].includes(project.name))
			.map((project) => ({ name: project.name, value: project.provide[FULL_TABLE_VARIABLE] }))
	} finally {
		vi.unstubAllEnvs()
		vi.resetModules()
	}
}

describe('the store contract, one file per leg', () => {
	it('every leg has its file, and the single contract file is gone', () => {
		expect({
			missing: LEG_FILES.filter((file) => !existsSync(join(PACKAGE_ROOT, file))),
			single: existsSync(join(PACKAGE_ROOT, SINGLE_CONTRACT_FILE)),
		}).toEqual({ missing: [], single: false })
	})

	it('the browser runs every leg', () => {
		const browserOnly = BROWSER_ONLY_TEST_FILES.map((file) => file.path)
		expect(LEG_FILES.filter((file) => !browserOnly.includes(file))).toEqual([])
	})

	it('node runs the legs of its own realm, never an engine worker leg', () => {
		expect(
			[...NODE_STORE_CONTRACT_TEST_FILES].filter((file) => file.includes('store-contract.')).sort(),
		).toEqual([...IN_REALM_LEG_FILES].sort())
	})

	for (const value of ['1', '0']) {
		it(`the projects running a leg hand it the full-table variable from the environment (${value})`, async () => {
			await expect(fullTableValuesWith({ value })).resolves.toEqual([
				{ name: 'node-indexeddb', value },
				{ name: 'browser', value },
				{ name: 'browser-all', value },
			])
		})
	}

	it('a release runs the whole suite in the browser with the full table: test:browser:release', () => {
		const scripts = (
			JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
				scripts: Record<string, string>
			}
		).scripts
		expect(scripts).toHaveProperty(
			'test:browser:release',
			expect.stringMatching(
				new RegExp(`^${FULL_TABLE_VARIABLE}=1 vitest run --project browser-all(?:\\s|$)`),
			),
		)
	})

	it('the projects running a leg provide the full-table value on a second channel, for the leg to compare', async () => {
		await expect(providedFullTableWith({ value: '1' })).resolves.toEqual([
			{ name: 'node-indexeddb', value: '1' },
			{ name: 'browser', value: '1' },
			{ name: 'browser-all', value: '1' },
		])
	})

	it('the suite reads the full-table variable by its name (a static read the browser fills)', () => {
		expect(
			readFileSync(join(PACKAGE_ROOT, 'src/store/contract/store-contract.suite.ts'), 'utf8'),
		).toContain(`import.meta.env.${FULL_TABLE_VARIABLE}`)
	})

	for (const [leg, subset] of Object.entries(LEG_SUBSETS)) {
		it(`the ${leg} leg runs the ${subset} subset`, () => {
			expect(
				readFileSync(
					join(
						PACKAGE_ROOT,
						STORE_CONTRACT_LEG_FILES[leg as keyof typeof STORE_CONTRACT_LEG_FILES],
					),
					'utf8',
				),
			).toMatch(new RegExp(`subset: '${subset}'`))
		})
	}
})
