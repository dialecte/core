import { TEST_DIALECTE_CONFIG } from './config'
import { createTestProject } from './create-test-dialecte'

import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'

import type { TestProjectResult } from './create-test-dialecte.types'

type OpenedProject = TestProjectResult<typeof TEST_DIALECTE_CONFIG>

const SOURCE_XML = '<Root><A aA="a1" /></Root>'

/** The project still answers: its record is there (a destroyed project's store is gone). */
async function isOpen(opened: OpenedProject): Promise<boolean> {
	try {
		const records = await opened.source.document.query.getRecordsByTagName('A')
		return records.length === 1
	} catch {
		return false
	}
}

/** The project a test left behind, read by the test that runs after it. */
const left: { afterItsTest?: OpenedProject; fromBeforeAll?: OpenedProject } = {}

describe('a test project is destroyed when its test ends', () => {
	it('opened in a test body → open during the test', async () => {
		const opened = await createTestProject({ sourceXml: SOURCE_XML })
		left.afterItsTest = opened

		const open = await isOpen(opened)
		expect(open).toBe(true)
	})

	it('the project of the test before → destroyed with that test', async () => {
		const open = left.afterItsTest ? await isOpen(left.afterItsTest) : true
		expect(open).toBe(false)
	})
})

describe('a wrapper with its own onTestFinished', () => {
	it('a hook registered after createTestProject sees the project open', async () => {
		const opened = await createTestProject({ sourceXml: SOURCE_XML })
		onTestFinished(async () => {
			const openInHook = await isOpen(opened)
			expect(openInHook).toBe(true)
		})

		const open = await isOpen(opened)
		expect(open).toBe(true)
	})

	it('a hook registered BEFORE createTestProject still sees the project open in its hook (the destroy comes last, whatever the order)', async () => {
		let opened: OpenedProject | undefined
		onTestFinished(async () => {
			const openInHook = opened ? await isOpen(opened) : false
			expect(openInHook).toBe(true)
		})
		opened = await createTestProject({ sourceXml: SOURCE_XML })

		const open = await isOpen(opened)
		expect(open).toBe(true)
	})
})

describe('a project opened outside a running test', () => {
	beforeAll(async () => {
		left.fromBeforeAll = await createTestProject({ sourceXml: SOURCE_XML })
	})
	afterAll(() => left.fromBeforeAll?.project.destroy())

	it('is open while its suite runs', async () => {
		const open = left.fromBeforeAll ? await isOpen(left.fromBeforeAll) : false
		expect(open).toBe(true)
	})

	it('is still open in the next test of its suite: the caller destroys it, not the end of a test', async () => {
		const open = left.fromBeforeAll ? await isOpen(left.fromBeforeAll) : false
		expect(open).toBe(true)
	})
})
