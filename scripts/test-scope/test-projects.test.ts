import { readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'

import { DOCUMENT_SUITES_PATTERN } from '../../vitest.config.constants'
import { PACKAGE_ROOT } from './test-scope.constants'
import { configuredProjects } from './vitest-projects.fixtures'

import { describe, expect, it } from 'vitest'

import type { ConfiguredProject } from './vitest-projects.fixtures.types'

/** A Document suite file: what each store's leg must run. */
const DOCUMENT_SUITE_FILE = 'src/document/document.test.ts'

type PackageJson = {
	scripts: Record<string, string>
	dialecte: { gate: { full: { name: string; run: string }[] } }
}

function readPackageJson(): PackageJson {
	return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as PackageJson
}

function setupTextOf(project: ConfiguredProject): string {
	return project.setupFiles.map((file) => readFileSync(join(PACKAGE_ROOT, file), 'utf8')).join('\n')
}

/** The node project running the Document suites on a store: its setup names that store for the test helpers. */
function documentLegOf(params: { storage: string }): ConfiguredProject | undefined {
	const { storage } = params
	return configuredProjects().find(function runsDocumentsOn(project) {
		return (
			project.environment === 'node' &&
			project.include.some((pattern) => matchesGlob(DOCUMENT_SUITE_FILE, pattern)) &&
			setupTextOf(project).includes(`useTestStorage({ type: '${storage}' })`)
		)
	})
}

type LegCase = {
	storage: string
	/** What else the leg's setup must import for the store to exist in node. */
	setupImports: string[]
	/** The leg's include, when it runs the Document suites only. */
	include?: string[]
}

const LEGS: Record<string, LegCase> = {
	'the in-memory store': { storage: 'inMemory', setupImports: [] },
	'SQLite in the test process': { storage: 'sqlite', setupImports: ["import '@/sqlite'"] },
	'IndexedDB through fake-indexeddb': {
		storage: 'local',
		setupImports: ["import 'fake-indexeddb/auto'"],
		include: [DOCUMENT_SUITES_PATTERN],
	},
}

describe('the node test projects', () => {
	for (const [name, leg] of Object.entries(LEGS)) {
		it(`the Document suites run in node on ${name}, as part of test:node`, () => {
			const project = documentLegOf({ storage: leg.storage })
			expect(project?.name).toEqual(expect.any(String))
			for (const line of leg.setupImports) expect(setupTextOf(project!)).toContain(line)
			if (leg.include) expect(project!.include).toEqual(leg.include)
			expect(readPackageJson().scripts['test:node']).toMatch(
				new RegExp(`--project ${project!.name}(?:\\s|$)`),
			)
		})
	}
})

describe('the Document legs', () => {
	it('each store has its own project: no project runs the Document suites on two stores', () => {
		const names = Object.values(LEGS).flatMap(function legName(leg) {
			const name = documentLegOf({ storage: leg.storage })?.name
			return name === undefined ? [] : [name]
		})
		expect({ found: names.length, distinct: new Set(names).size }).toEqual({
			found: Object.keys(LEGS).length,
			distinct: Object.keys(LEGS).length,
		})
	})
})

describe('the full gate', () => {
	it('runs the browser tests the change selects, through test:scope, never the whole browser project', () => {
		const packageJson = readPackageJson()
		const runs = packageJson.dialecte.gate.full.map((step) => step.run)
		expect(packageJson.scripts).toHaveProperty(
			'test:scope',
			expect.stringMatching(/scripts\/test-scope\/run-test-scope\.ts/),
		)
		expect(runs).toContain('npm run test:scope')
		// cli 0.3.1 reruns a failed test step serially on its failing files only when the step's script names vitest
		expect(packageJson.scripts['test:scope']).toMatch(/\bvitest\b/)
		expect(
			runs.filter((run) => /--project browser(?:\s|$)|npm run test:browser(?:\s|$)/.test(run)),
		).toEqual([])
	})
})
