import { sessionRecords } from '../../contract/store-contract.fixtures'
import { runsDirectly } from '../../engine/client/worker-connector'
import { fixtureFile, fixtureUrl } from '../runtime/runtime.fixtures'
import { TWO_DIALECTES_PROJECTS } from './sqlite-connector.fixtures.constants'

import { expect, onTestFinished } from 'vitest'

import { createProjectFactory } from '@/dialecte'

import type { SqliteEngineRegistration } from '../../sqlite-storage.types'
import type { TwoDialectesProject, TwoDialectesWhich } from './sqlite-connector.fixtures.types'

const FACTORIES = {
	first: createProjectFactory({ dialecte: TWO_DIALECTES_PROJECTS.first.dialecte }),
	second: createProjectFactory({ dialecte: TWO_DIALECTES_PROJECTS.second.dialecte }),
}

/** The engine an app registers for both dialectes of the `two-dialectes` fixture worker: one worker, one address. */
export function twoDialectesRegistration(): SqliteEngineRegistration {
	return {
		url: fixtureUrl({ scenario: 'two-dialectes' }),
		dialectes: [TWO_DIALECTES_PROJECTS.first.dialecte, TWO_DIALECTES_PROJECTS.second.dialecte],
	}
}

/** A project of that dialecte opened on `sqlite` through its factory; closed when the case ends. */
async function openProject(params: {
	name: string
	which: TwoDialectesWhich
}): Promise<TwoDialectesProject> {
	const opening = FACTORIES[params.which]({ storage: { type: 'sqlite' } }).open(params.name)
	// an open the store refuses fails the case on this assertion
	await expect(opening).resolves.toBeDefined()
	const project = await opening
	onTestFinished(function closeProject() {
		return project.close()
	})
	return project
}

/** Each dialecte's project of that name deleted once the case ends, after every view of it closed. */
function destroyBothWhenDone(params: { name: string }): void {
	onTestFinished(async function destroyBoth() {
		for (const which of ['first', 'second'] as const) {
			await FACTORIES[which].destroyProject({ name: params.name })
		}
	})
}

/**
 * One project name under both dialectes of one registration, one worker address: each project imports a file of its
 * dialecte (its own hooks say their diagnostics under their own source) and reads it back reopened, the other
 * dialecte's project of the same name holding only its own document - they are two projects. Run by the page itself
 * (`direct`) or through the origin's hub.
 */
export async function expectTwoDialectesThroughOneRegistration(params: {
	name: string
	direct: boolean
}): Promise<void> {
	const { name, direct } = params
	destroyBothWhenDone({ name })
	const documentIds: Record<TwoDialectesWhich, string> = { first: '', second: '' }
	for (const which of ['first', 'second'] as const) {
		const { namespaceUri, source, dialecte } = TWO_DIALECTES_PROJECTS[which]
		const project = await openProject({ name, which })
		const imported = await project.importFile(
			fixtureFile({ namespaceUri, body: sessionRecords(1) }),
		)
		expect(
			imported.diagnostics.map(function sourceOf(diagnostic) {
				return diagnostic.source
			}),
		).toEqual([source])
		documentIds[which] = imported.documentId
		expect(runsDirectly({ name, dialecteId: dialecte.id })).toBe(direct)
		await project.close()
	}
	for (const which of ['first', 'second'] as const) {
		const project = await openProject({ name, which })
		const documents = await project.getDocuments()
		expect(
			documents.map(function idOf(document) {
				return document.id
			}),
		).toEqual([documentIds[which]])
	}
}
