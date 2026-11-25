import { initEmptyDocument } from './init-empty-document'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { InMemoryStore } from '@/store'
import { runTestCases, TEST_DIALECTE_CONFIG } from '@/test'

import type { Store } from '@/store'
import type { BaseTestCase } from '@/test'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ROOT = TEST_DIALECTE_CONFIG.rootElementName
const ROOT_DEFINITION = TEST_DIALECTE_CONFIG.definition[ROOT]
const EXT_NAMESPACE = ROOT_DEFINITION.attributes.details['ext:root'].namespace

/**
 * The test dialecte, its root declaring four more attributes: `a` required and fixed, `ext:a` the same in another
 * namespace, `b` required with no fixed value, `c` fixed but optional.
 */
const FIXED_ROOT_CONFIG = {
	...TEST_DIALECTE_CONFIG,
	definition: {
		...TEST_DIALECTE_CONFIG.definition,
		[ROOT]: {
			...ROOT_DEFINITION,
			attributes: {
				...ROOT_DEFINITION.attributes,
				sequence: [...ROOT_DEFINITION.attributes.sequence, 'a', 'b', 'c', 'ext:a'],
				details: {
					...ROOT_DEFINITION.attributes.details,
					a: { required: true, fixed: '2007' },
					b: { required: true },
					c: { fixed: 'C' },
					'ext:a': { required: true, fixed: '5', namespace: EXT_NAMESPACE },
				},
			},
		},
	},
} as unknown as AnyDialecteConfig

/** The root record a created document stores, through a store that keeps what it is given. */
async function createdRoot(params: { config: AnyDialecteConfig }): Promise<AnyRawRecord> {
	const bulkWrite = vi.fn()
	const store = { registerDocument: vi.fn(), bulkWrite } as unknown as Store

	await initEmptyDocument({
		store,
		configs: { default: params.config },
		defaultConfigKey: 'default',
	})

	return bulkWrite.mock.calls[0][1].creates[0]
}

/** The stored root of the created document: its attributes as written, no schema value filled in. */
async function storedRoot(params: { store: Store; documentId: string }): Promise<AnyRawRecord> {
	const { store, documentId } = params
	const [root] = await store.getByTagNameInDocument(ROOT, documentId)
	return root
}

const made: Store[] = []

afterEach(async () => {
	for (const store of made.splice(0)) await store.destroy()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('initEmptyDocument: the root states the required attributes its schema fixes', () => {
	type RootCase = BaseTestCase & {
		config: AnyDialecteConfig
		expectedAttributes: AnyRawRecord['attributes']
	}
	const testCases: Record<string, RootCase> = {
		'required and fixed attributes -> written with their fixed values, a qualified one in its namespace; required without a fixed value and optional fixed ones absent':
			{
				config: FIXED_ROOT_CONFIG,
				expectedAttributes: [
					{ name: 'a', value: '2007' },
					{ name: 'ext:a', value: '5', namespace: EXT_NAMESPACE },
				],
			},
		'no required fixed attribute on the root -> none written': {
			config: TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig,
			expectedAttributes: [],
		},
	}

	runTestCases.generic(testCases, async (testCase) => {
		const root = await createdRoot({ config: testCase.config })

		expect(root.attributes).toEqual(testCase.expectedAttributes)
	})

	it('the afterStandardizedRecord hook -> sees the root with them', async () => {
		const seen: AnyRawRecord['attributes'][] = []
		const store = { registerDocument: vi.fn(), bulkWrite: vi.fn() } as unknown as Store

		await initEmptyDocument({
			store,
			configs: { default: FIXED_ROOT_CONFIG },
			defaultConfigKey: 'default',
			hooks: {
				afterStandardizedRecord: function recordSeen({ record }) {
					seen.push(record.attributes)
					return record
				},
			},
		})

		expect(seen).toEqual([
			[
				{ name: 'a', value: '2007' },
				{ name: 'ext:a', value: '5', namespace: EXT_NAMESPACE },
			],
		])
	})

	it('on a project store -> the stored root holds them', async () => {
		const runtime = { configs: { default: FIXED_ROOT_CONFIG }, defaultConfigKey: 'default' }
		const store = new InMemoryStore('root-fixed-attributes', { runtime })
		made.push(store)
		await store.open()

		const { documentId } = await initEmptyDocument({
			store,
			configs: runtime.configs,
			defaultConfigKey: 'default',
		})

		const root = await storedRoot({ store, documentId })
		expect(root.attributes).toEqual([
			{ name: 'a', value: '2007' },
			{ name: 'ext:a', value: '5', namespace: EXT_NAMESPACE },
		])
	})
})
