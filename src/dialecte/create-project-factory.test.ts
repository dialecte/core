import { createProjectFactory } from './create-project-factory'
import { createCountingDialecte, ENGINE_URL } from './create-project-factory.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { Project } from '@/project'
import { XMLNS_DEFAULT_NAMESPACE } from '@/test/constant'

const SOURCE_XML = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/><A aA="2"/></Root>`

describe('createProjectFactory', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	it('carries the declaration and the engine address', () => {
		const dialecte = createCountingDialecte()
		const factory = createProjectFactory({ dialecte, engineUrl: ENGINE_URL })
		expect(factory.dialecte).toBe(dialecte)
		expect(factory.engineUrl).toBe(ENGINE_URL)
	})

	it('carries the spawner a page registers with the hub: the dialecte, its version and its engine address, nothing else', () => {
		const dialecte = createCountingDialecte()
		const factory = createProjectFactory({ dialecte, engineUrl: ENGINE_URL })
		expect(factory.spawner).toStrictEqual({
			dialecteId: dialecte.id,
			dialecteVersion: dialecte.version,
			engineUrl: ENGINE_URL,
		})
	})

	it('a project opens with every config and the declared default key', async () => {
		const factory = createProjectFactory({
			dialecte: createCountingDialecte(),
			engineUrl: ENGINE_URL,
		})
		const project = await factory({ storage: { type: 'inMemory' } }).open('factory-configs')
		projects.push(project)

		const byDefault = await project.initEmptyDocument()
		const bySecond = await project.initEmptyDocument({ configKey: 'second' })
		const byDefaultDocument = await project.getDocument(byDefault)
		expect(byDefaultDocument?.configKey).toBe('first')
		const bySecondDocument = await project.getDocument(bySecond)
		expect(bySecondDocument?.configKey).toBe('second')
		const thrown = await project.initEmptyDocument({ configKey: 'third' }).catch((error) => error)
		expect(toDialecteError(thrown)?.key).toBe('UNKNOWN_CONFIG_KEY')
	})

	it('merges the declared extensions with the ones given per project', async () => {
		const factory = createProjectFactory({
			dialecte: createCountingDialecte(),
			engineUrl: ENGINE_URL,
		})
		const custom = { greeting: { query: { hello: () => 'hello' } } }
		const project = await factory({ storage: { type: 'inMemory' }, extensions: custom }).open(
			'factory-extensions',
		)
		projects.push(project)
		const { documentId } = await project.importFile(new File([SOURCE_XML], 'source.xml'))
		const document = project.openDocument(documentId)

		const countOfA = await document.query.counting.countA()
		expect(countOfA).toBe(2)
		expect(document.query.greeting.hello()).toBe('hello')
	})

	it('creates one hooks instance per project, each project running its own', async () => {
		const instancesSeen: number[] = []
		let created = 0
		const factory = createProjectFactory({
			dialecte: createCountingDialecte({
				createHooks: () => {
					const instance = ++created
					return {
						beforeImport: (xml) => {
							instancesSeen.push(instance)
							return xml
						},
					}
				},
			}),
			engineUrl: ENGINE_URL,
		})
		expect(created).toBe(0)

		const first = await factory({ storage: { type: 'inMemory' } }).open('factory-hooks-1')
		const second = await factory({ storage: { type: 'inMemory' } }).open('factory-hooks-2')
		projects.push(first, second)
		expect(created).toBe(2)

		await second.importFile(new File([SOURCE_XML], 'source.xml'))
		await first.importFile(new File([SOURCE_XML], 'source.xml'))
		await second.importFile(new File([SOURCE_XML], 'source.xml'))
		expect(instancesSeen).toEqual([2, 1, 2])
	})

	describe('a project on sqlite storage, where the page can run no engine (node)', () => {
		type TestCase = { open: () => Promise<unknown>; refusedWith: string }
		const testCases: Record<string, TestCase> = {
			'made by the factory → STORE_UNAVAILABLE at open, nothing started': {
				open: function openFromFactory() {
					const factory = createProjectFactory({
						dialecte: createCountingDialecte(),
						engineUrl: ENGINE_URL,
					})
					return factory({ storage: { type: 'sqlite' } }).open(`sqlite-${crypto.randomUUID()}`)
				},
				refusedWith: 'STORE_UNAVAILABLE',
			},
			'destroyed by name through the factory → STORE_UNAVAILABLE, nothing started': {
				open: function destroyByName() {
					const factory = createProjectFactory({
						dialecte: createCountingDialecte(),
						engineUrl: ENGINE_URL,
					})
					return factory.destroyProject({ name: `sqlite-${crypto.randomUUID()}` })
				},
				refusedWith: 'STORE_UNAVAILABLE',
			},
			'made by no factory → PROJECT_ENGINE_NOT_DECLARED at open': {
				open: function openBare() {
					const dialecte = createCountingDialecte()
					return new Project({
						configs: dialecte.configs,
						storage: { type: 'sqlite' },
						dialecteId: dialecte.id,
					}).open(`sqlite-${crypto.randomUUID()}`)
				},
				refusedWith: 'PROJECT_ENGINE_NOT_DECLARED',
			},
		}
		for (const [description, { open, refusedWith }] of Object.entries(testCases)) {
			it(description, async () => {
				const key = await open().then(
					function opened() {
						return 'opened'
					},
					function refused(thrown: unknown) {
						return toDialecteError(thrown)?.key
					},
				)
				expect(key).toBe(refusedWith)
			})
		}
	})
})
