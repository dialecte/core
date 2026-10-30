import { createProjectFactory } from './create-project-factory'
import { createCountingDialecte, ENGINE_URL } from './create-project-factory.fixtures'

import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
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
})
