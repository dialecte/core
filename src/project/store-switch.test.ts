import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG, XMLNS_DEFAULT_NAMESPACE } from '@/test'

import type { StorageParam } from './types'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, DialecteHooks } from '@/types'

// The store is a switch: what a project does through its public API is the same whichever store it
// runs on. Every case runs on every storage; a case red on one storage only is a store bug.

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

const STORAGES: Record<string, StorageParam> = {
	'in memory': { type: 'inMemory' },
	'on IndexedDB': { type: 'local' },
}

const HOOK_TEXT = 'written by the hook'

function leafFile(): File {
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
	return new File([xml], 'leaf.xml', { type: 'text/xml' })
}

/** Import hooks whose session rewrites the text of every `CCCC_1` once the file is stored. */
const TEXT_WRITING_HOOKS: DialecteHooks<AnyDialecteConfig> = {
	createImportSession: () => {
		const leafIds: string[] = []
		return {
			recordTagNames: ['CCCC_1'],
			beforeImportRecord: ({ record }) => {
				leafIds.push(record.id)
			},
			afterImport: async () => ({
				updates: leafIds.map((recordId) => ({ recordId, value: HOOK_TEXT })),
			}),
		}
	},
}

const opened: Project<AnyDialecteConfig>[] = []

/** A project open on `storage`, under `name` when given (a new name otherwise). */
async function openProject(params: {
	storage: StorageParam
	hooks?: DialecteHooks<AnyDialecteConfig>
	name?: string
}): Promise<Project<AnyDialecteConfig>> {
	const { storage, hooks, name = `store-switch-${crypto.randomUUID()}` } = params
	const project = await new Project({ configs: { default: CONFIG }, storage, hooks }).open(name)
	opened.push(project)
	return project
}

const CASES: Record<
	string,
	BaseTestCase & {
		/** `dom`: the case exports a document, which needs a DOM; skipped where there is none (node). */
		needs?: 'dom'
		act: (storage: StorageParam) => Promise<void>
	}
> = {
	'an import hook rewrites a text value → the export carries the hook’s text': {
		needs: 'dom',
		act: async function hookTextReachesExport(storage) {
			const project = await openProject({ storage, hooks: TEXT_WRITING_HOOKS })
			const { documentId } = await project.importFile(leafFile())

			const { xmlDocument } = await project.export({ documentId, indent: false, xmlDocument: true })

			expect(xmlDocument.getElementsByTagName('CCCC_1')[0]?.textContent).toBe(HOOK_TEXT)
		},
	},
	'a project closed, then a new project opened under its name → the document is there, its records read':
		{
			act: async function reopenByName(storage) {
				const first = await openProject({ storage })
				const { documentId } = await first.importFile(leafFile())
				await first.close()

				const second = await openProject({ storage, name: first.name })

				expect((await second.getDocuments()).map((document) => document.id)).toEqual([documentId])
				const [leaf] = await second.openDocument(documentId).query.getRecordsByTagName('CCCC_1')
				expect(leaf?.value).toBe('as imported')
			},
		},
	'a destroyed project → getDocuments rejects with PROJECT_NOT_OPENED': {
		act: async function readAfterDestroy(storage) {
			const project = await openProject({ storage })
			await project.importFile(leafFile())

			await project.destroy()

			await expect(project.getDocuments()).rejects.toMatchObject({
				cause: { key: 'PROJECT_NOT_OPENED' },
			})
		},
	},
}

describe('Project - the same on every store', () => {
	afterEach(async () => {
		for (const project of opened.splice(0)) await project.destroy()
	})

	for (const [storageName, storage] of Object.entries(STORAGES)) {
		describe(storageName, () => {
			for (const [description, testCase] of Object.entries(CASES)) {
				const skipped = testCase.needs === 'dom' && typeof document === 'undefined'
				const testFn = skipped ? it.skip : testCase.only ? it.only : it
				testFn(description, () => testCase.act(storage))
			}
		})
	}
})
