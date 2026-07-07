import { Project } from './project'

import { afterEach, describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig

function projectName(): string {
	return `history-status-test-${crypto.randomUUID()}`
}

function openProject(name: string) {
	return new Project({ configs: { default: CONFIG }, storage: { type: 'local' } }).open(name)
}

function minimalXml(): string {
	return `<Root xmlns="${CONFIG.namespaces.default.uri}"><A/></Root>`
}

async function importOne(project: Project<AnyDialecteConfig>): Promise<string> {
	const file = new File([minimalXml()], 'test.xml', { type: 'application/xml' })
	const [{ documentId }] = await project.import([file])
	return documentId
}

async function commitChild(project: Project<AnyDialecteConfig>, documentId: string): Promise<void> {
	const doc = project.openDocument(documentId)
	await doc.transaction(async (tx) => {
		const root = await tx.getRoot()
		tx.addChild(root, { tagName: 'A', attributes: [] })
	})
}

/** BroadcastChannel delivery + the fire-and-forget flag refresh are async */
function settle(): Promise<void> {
	return new Promise((r) => setTimeout(r, 25))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('canUndo/canRedo history status', () => {
	const cleanups: Array<() => Promise<void>> = []

	afterEach(async () => {
		for (const fn of cleanups) await fn()
		cleanups.length = 0
	})

	it('fresh document → both false', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await importOne(project)
		const entry = project.state.documents.get(documentId)

		expect(entry?.canUndo).toBe(false)
		expect(entry?.canRedo).toBe(false)
	})

	it('after a commit → canUndo true, canRedo false', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await importOne(project)
		await commitChild(project, documentId)
		await settle()

		const entry = project.state.documents.get(documentId)
		expect(entry?.canUndo).toBe(true)
		expect(entry?.canRedo).toBe(false)
	})

	it('undo to bottom → canUndo false, canRedo true, lastUpdate bumped', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await importOne(project)
		await commitChild(project, documentId)

		const before = project.state.documents.get(documentId)?.lastUpdate
		await project.undo(documentId)

		const entry = project.state.documents.get(documentId)
		expect(entry?.canUndo).toBe(false)
		expect(entry?.canRedo).toBe(true)
		expect(entry?.lastUpdate).toBeGreaterThanOrEqual(before!)
	})

	it('redo → canUndo true, canRedo false again', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await importOne(project)
		await commitChild(project, documentId)
		await project.undo(documentId)
		await project.redo(documentId)

		const entry = project.state.documents.get(documentId)
		expect(entry?.canUndo).toBe(true)
		expect(entry?.canRedo).toBe(false)
	})

	it('commit after undo truncates the redo branch → canRedo false', async () => {
		const project = await openProject(projectName())
		cleanups.push(() => project.destroy())

		const documentId = await importOne(project)
		await commitChild(project, documentId)
		await commitChild(project, documentId)
		await project.undo(documentId)
		expect(project.state.documents.get(documentId)?.canRedo).toBe(true)

		await commitChild(project, documentId)
		await settle()

		const entry = project.state.documents.get(documentId)
		expect(entry?.canUndo).toBe(true)
		expect(entry?.canRedo).toBe(false)
	})

	it('reopening the project restores flags from persisted history', async () => {
		const name = projectName()
		const project = await openProject(name)

		const documentId = await importOne(project)
		await commitChild(project, documentId)
		await settle()
		project.close()

		const reopened = await openProject(name)
		cleanups.push(() => reopened.destroy())

		const entry = reopened.state.documents.get(documentId)
		expect(entry?.canUndo).toBe(true)
		expect(entry?.canRedo).toBe(false)
	})

	it('a second Project instance converges via the channel', async () => {
		const name = projectName()
		const projectA = await openProject(name)
		const documentId = await importOne(projectA)

		const projectB = await openProject(name)
		cleanups.push(async () => projectB.close())
		cleanups.push(() => projectA.destroy())

		await commitChild(projectA, documentId)
		await settle()

		const entryB = projectB.state.documents.get(documentId)
		expect(entryB?.lastUpdate).not.toBeNull()
		expect(entryB?.canUndo).toBe(true)
		expect(entryB?.canRedo).toBe(false)
	})
})
