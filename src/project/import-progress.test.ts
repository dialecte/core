import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { phasesInOrder } from '@/store/contract/store-contract.fixtures'
import { withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'
import { testStoreFor } from '@/test/test-storage'

import type { ImportEntry, ImportFileEntry, ImportFilesProgress, StorageParam } from './types'
import type { ImportProgress } from '@/store/store.types'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// `project.import` tells each file's progress and end the same whichever store runs it: every case on every storage.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

const DIALECTE_ID = 'core/test'

/** The step the reporting hooks' session tells. */
const REPORTED_STEP = 'leaves'

/** How a project of a case gets its storage: by its name, the engine's hooks given (SQLite runs its own). */
type StorageOf = (params: {
	name: string
	hooks?: DialecteHooks<AnyDialecteConfig>
}) => Promise<StorageParam>

const STORAGES: Record<string, StorageOf> = {
	'in memory': async function inMemory() {
		return { type: 'inMemory' }
	},
	'on IndexedDB': async function local() {
		return { type: 'local' }
	},
	'on SQLite (the engine in this realm)': function sqliteInProcess({ name, hooks }) {
		withSqliteStorage()
		return testStoreFor({
			storage: { type: 'sqlite' },
			name,
			dialecte: {
				id: DIALECTE_ID,
				configs: { default: CONFIG },
				defaultConfigKey: 'default',
				createHooks: function engineHooks() {
					return hooks ?? {}
				},
			},
		})
	},
}

function leafFile(params: { name: string }): File {
	const xml = /* xml */ `
		<Root ${XMLNS_DEFAULT_NAMESPACE}>
			<C aC="c">
				<CC_1 aCC_1="fixed_val">
					<CCC_1 aCCC_1="ccc">
						<CCCC_1 aCCCC_1="leaf">as imported</CCCC_1>
					</CCC_1>
				</CC_1>
			</C>
		</Root>
	`
	return new File([xml], params.name, { type: 'text/xml' })
}

/** A file whose XML is not well-formed: its import fails `PARSE_ERROR`. */
function brokenFile(): File {
	return new File(['<Root><unclosed></Root>'], 'broken.xml', { type: 'text/xml' })
}

/** Import hooks whose session reports one step over the leaves it was handed, then rewrites their text. */
const REPORTING_HOOKS: DialecteHooks<AnyDialecteConfig> = {
	createImportSession: () => {
		const leafIds: string[] = []
		return {
			recordTagNames: ['CCCC_1'],
			beforeImportRecord: ({ record }) => {
				leafIds.push(record.id)
			},
			afterImport: async ({ report }) => {
				report({ step: REPORTED_STEP, done: leafIds.length, total: leafIds.length })
				return { updates: leafIds.map((recordId) => ({ recordId, value: 'written by the hook' })) }
			},
		}
	},
}

/** The step a processing progress names. */
function stepOf(params: { progress: ImportFilesProgress }): string | undefined {
	const { progress } = params
	return progress.phase === 'processing' ? progress.step : undefined
}

const opened: Project<AnyDialecteConfig>[] = []

/** A project open on `storage` under a new name. */
async function openProject(params: {
	storage: StorageOf
	hooks?: DialecteHooks<AnyDialecteConfig>
}): Promise<Project<AnyDialecteConfig>> {
	const { storage, hooks } = params
	const name = `import-progress-${crypto.randomUUID()}`
	const projectStorage = await storage({ name, hooks })
	const project = await new Project({
		configs: { default: CONFIG },
		storage: projectStorage,
		hooks,
		dialecteId: DIALECTE_ID,
	}).open(name)
	opened.push(project)
	return project
}

/** What a project's `import` told and answered. */
type Told = {
	heard: ImportFilesProgress[]
	ended: ImportFileEntry[]
	order: string[]
	entries: ImportEntry[]
}

/** Import the files, keeping what the listeners were told, in the order told. */
async function importTold(params: {
	project: Project<AnyDialecteConfig>
	files: File[]
}): Promise<Told> {
	const { project, files } = params
	const heard: ImportFilesProgress[] = []
	const ended: ImportFileEntry[] = []
	const order: string[] = []
	const entries = await project.import(files, {
		onProgress: function keepProgress(progress) {
			heard.push(progress)
			order.push(`progress ${progress.fileIndex}`)
		},
		onFile: function keepEntry(entry) {
			ended.push(entry)
			order.push(`file ${entry.fileName}`)
		},
	})
	return { heard, ended, order, entries }
}

type TestCase = {
	hooks?: DialecteHooks<AnyDialecteConfig>
	files: () => File[]
	expect: (told: Told) => void
}

const CASES: Record<string, TestCase> = {
	'two files imported with a reporting hook → each file told in order, storing, processing (start, its steps), checking, applying, finishing, fileIndex 0 then 1 of 2 with its name; onFile told as each file ends':
		{
			hooks: REPORTING_HOOKS,
			files: () => [leafFile({ name: 'leaf.xml' }), leafFile({ name: 'second.xml' })],
			expect: function eachFileTold({ heard, ended, order, entries }) {
				expect(entries.map((entry) => entry.status)).toEqual(['imported', 'imported'])
				expect(ended).toEqual(entries.map((entry, fileIndex) => ({ ...entry, fileIndex })))
				// a file's end told before the next file's first progress
				expect(order.indexOf('file leaf.xml')).toBeLessThan(order.indexOf('progress 1'))
				expect(order.at(-1)).toBe('file second.xml')
				expect([...new Set(heard.map((progress) => progress.fileIndex))]).toEqual([0, 1])
				for (const [fileIndex, fileName] of ['leaf.xml', 'second.xml'].entries()) {
					const ofFile = heard.filter((progress) => progress.fileIndex === fileIndex)
					expect(ofFile.every((progress) => progress.fileCount === 2)).toBe(true)
					expect(ofFile.every((progress) => progress.fileName === fileName)).toBe(true)
					expect(phasesInOrder({ progress: ofFile })).toEqual([
						'storing',
						'processing',
						'checking',
						'applying',
						'finishing',
					])
					expect(
						ofFile
							.filter((progress) => progress.phase === 'processing')
							.map((progress) => stepOf({ progress })),
					).toEqual(['start', REPORTED_STEP])
				}
			},
		},
	'two files, the first one failing → onFile told for each, the failed one with its error; the second file still reported':
		{
			files: () => [brokenFile(), leafFile({ name: 'leaf.xml' })],
			expect: function failedFileTold({ heard, ended, entries }) {
				expect(ended).toEqual(entries.map((entry, fileIndex) => ({ ...entry, fileIndex })))
				expect(ended.map((entry) => [entry.fileName, entry.status])).toEqual([
					['broken.xml', 'failed'],
					['leaf.xml', 'imported'],
				])
				expect(ended[0]).toMatchObject({ error: { key: 'PARSE_ERROR' } })
				expect(heard.filter((progress) => progress.fileIndex === 1).at(-1)).toMatchObject({
					phase: 'finishing',
					fileName: 'leaf.xml',
					fileCount: 2,
				})
			},
		},
}

/** The phases one import told, in order, each once. */
function phasesOf(params: { progress: readonly ImportProgress[] }): ImportProgress['phase'][] {
	return params.progress
		.map((step) => step.phase)
		.filter((phase, index, phases) => phase !== phases[index - 1])
}

type ProjectCase = { act: (params: { storage: StorageOf }) => Promise<void> }

const PROJECT_CASES: Record<string, ProjectCase> = {
	'two files of one name → onFile tells each entry with its place, 0 then 1': {
		act: async function samenamedFiles({ storage }) {
			const project = await openProject({ storage })
			const told = await importTold({
				project,
				files: [leafFile({ name: 'leaf.xml' }), leafFile({ name: 'leaf.xml' })],
			})
			expect(told.ended.map((entry) => [entry.fileName, entry.fileIndex])).toEqual([
				['leaf.xml', 0],
				['leaf.xml', 1],
			])
		},
	},
	'two imports in one project, the second asked while the first runs → the second tells waiting before storing; the first never waits':
		{
			act: async function secondWaits({ storage }) {
				const project = await openProject({ storage })
				const first: ImportProgress[] = []
				const second: ImportProgress[] = []
				const both = [
					project.importFile(leafFile({ name: 'first.xml' }), {
						onProgress: (progress) => first.push(progress),
					}),
					project.importFile(leafFile({ name: 'second.xml' }), {
						onProgress: (progress) => second.push(progress),
					}),
				]
				await Promise.all(both)
				expect(phasesOf({ progress: second }).slice(0, 2)).toEqual(['waiting', 'storing'])
				expect(first.some((progress) => progress.phase === 'waiting')).toBe(false)
			},
		},
}

describe('Project - an import told while it waits, and its entry told with its place, on every store', () => {
	afterEach(async () => {
		const projects = opened.splice(0)
		for (const project of projects) await project.close()
		for (const project of projects) await project.destroy()
	})

	for (const [storageName, storage] of Object.entries(STORAGES)) {
		describe(storageName, () => {
			for (const [description, testCase] of Object.entries(PROJECT_CASES)) {
				it(description, () => testCase.act({ storage }))
			}
		})
	}
})

describe('Project.import - each file told, on every store', () => {
	afterEach(async () => {
		const projects = opened.splice(0)
		for (const project of projects) await project.close()
		for (const project of projects) await project.destroy()
	})

	for (const [storageName, storage] of Object.entries(STORAGES)) {
		describe(storageName, () => {
			for (const [description, testCase] of Object.entries(CASES)) {
				it(description, async () => {
					const project = await openProject({ storage, hooks: testCase.hooks })
					const told = await importTold({ project, files: testCase.files() })
					testCase.expect(told)
				})
			}
		})
	}
})
