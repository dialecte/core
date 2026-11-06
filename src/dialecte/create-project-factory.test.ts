import { createProjectFactory } from './create-project-factory'
import { createCountingDialecte, ENGINE_URL } from './create-project-factory.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { Project } from '@/project'
import { withoutSqliteStorage, withSqliteStorage } from '@/store/sqlite/sqlite-storage.fixtures'
import { XMLNS_DEFAULT_NAMESPACE } from '@/test/constant'

const SOURCE_XML = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/><A aA="2"/></Root>`

describe('createProjectFactory', () => {
	const projects: Array<{ destroy: () => Promise<void> }> = []
	afterEach(async () => {
		await Promise.all(projects.map((project) => project.destroy()))
		projects.length = 0
	})

	it('carries the declaration, and its destroyProject: no engine address, no spawner', () => {
		const dialecte = createCountingDialecte()
		const factory = createProjectFactory({ dialecte })
		expect(factory.dialecte).toBe(dialecte)
		expect(factory.destroyProject).toBeTypeOf('function')
		expect(factory).not.toHaveProperty('engineUrl')
		expect(factory).not.toHaveProperty('spawner')
		expect(Object.keys(factory).sort()).toEqual(['destroyProject', 'dialecte'])
	})

	it('an engine address passed to the factory → a type error: the app registers its engine with registerSqliteEngine', () => {
		const dialecte = createCountingDialecte()
		// @ts-expect-error the factory takes the declaration only
		const factory = createProjectFactory({ dialecte, engineUrl: ENGINE_URL })
		expect(factory).not.toHaveProperty('engineUrl')
	})

	it('a project opens with every config and the declared default key', async () => {
		const factory = createProjectFactory({ dialecte: createCountingDialecte() })
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
		const factory = createProjectFactory({ dialecte: createCountingDialecte() })
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

	describe('a project on sqlite storage refused before any engine', () => {
		type TestCase = { open: () => Promise<unknown>; refusedWith: string; imported?: false }
		const testCases: Record<string, TestCase> = {
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
			'made by the factory, @dialecte/core/sqlite never imported → PROJECT_SQLITE_NOT_IMPORTED at open':
				{
					open: function openFromFactory() {
						const factory = createProjectFactory({ dialecte: createCountingDialecte() })
						return factory({ storage: { type: 'sqlite' } }).open(`sqlite-${crypto.randomUUID()}`)
					},
					refusedWith: 'PROJECT_SQLITE_NOT_IMPORTED',
					imported: false,
				},
			'destroyed by name, @dialecte/core/sqlite never imported → PROJECT_SQLITE_NOT_IMPORTED': {
				open: function destroyByName() {
					const factory = createProjectFactory({ dialecte: createCountingDialecte() })
					return factory.destroyProject({ name: `sqlite-${crypto.randomUUID()}` })
				},
				refusedWith: 'PROJECT_SQLITE_NOT_IMPORTED',
				imported: false,
			},
		}
		for (const [description, { open, refusedWith, imported }] of Object.entries(testCases)) {
			it(description, async () => {
				if (imported === false) withoutSqliteStorage()
				else withSqliteStorage()
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
