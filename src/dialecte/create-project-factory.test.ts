import { createProjectFactory } from './create-project-factory'
import { defineDialecte } from './define-dialecte'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE_CONFIG } from '@/test/config'
import { XMLNS_DEFAULT_NAMESPACE } from '@/test/constant'

import type { DialecteHooks } from '@/types'

const ENGINE_URL = 'https://dialecte.test/assets/engine.worker.js'
const SOURCE_XML = /* xml */ `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/><A aA="2"/></Root>`

const BASE_MODULES = {
	counting: {
		query: {
			countA: async (query: { getRecordsByTagName: (tagName: 'A') => Promise<unknown[]> }) =>
				(await query.getRecordsByTagName('A')).length,
		},
	},
}

function createCountingDialecte(params?: {
	createHooks?: () => DialecteHooks<typeof TEST_DIALECTE_CONFIG>
}) {
	return defineDialecte({
		id: 'core/test',
		version: '0.0.0',
		configs: { first: TEST_DIALECTE_CONFIG, second: TEST_DIALECTE_CONFIG },
		defaultConfigKey: 'first',
		extensions: BASE_MODULES,
		createHooks: params?.createHooks,
	})
}

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
		expect((await project.getDocument(byDefault))?.configKey).toBe('first')
		expect((await project.getDocument(bySecond))?.configKey).toBe('second')
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

		expect(await document.query.counting.countA()).toBe(2)
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

	it('without a storage choice the project opens on the local store', async () => {
		const factory = createProjectFactory({
			dialecte: createCountingDialecte(),
			engineUrl: ENGINE_URL,
		})
		const project = await factory().open(`factory-local-${crypto.randomUUID()}`)
		projects.push(project)
		expect(await Dexie.exists(project.name)).toBe(true)
	})
})
