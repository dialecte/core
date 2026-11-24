import { describe, expect } from 'vitest'

import { defineDialecte } from '@/dialecte'
import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	TEST_CONFIG_KEY,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	createTestRunner,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const id = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`

/** The test dialecte with DDD_2 (anyType: any child) a transparent element. */
const TRANSPARENT_DIALECTE = defineDialecte({
	id: 'core/test-transparent-move',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: { ...TEST_DIALECTE_CONFIG, transparentElements: ['DDD_2'] as const },
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})
const runTransparentCases = createTestRunner({ dialecte: TRANSPARENT_DIALECTE })

/** Contract: a transparent element is never moved under one of its own descendants. */
describe('move - a transparent element under its own descendant', () => {
	type TestCase = BaseXmlTestCase & { expectedKey: string }

	const testCases: TestCases<TestCase> = {
		'y (transparent) moved under z, its child → MOVE_INTO_OWN_SUBTREE, nothing moved': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<D ${id}="d" aD="d">
						<DD_2 ${id}="dd" aDD_2="dd">
							<DDD_2 ${id}="x">
								<DDD_2 ${id}="y">
									<DDD_2 ${id}="z" />
								</DDD_2>
							</DDD_2>
						</DD_2>
					</D>
				</Root>
			`,
			expectedKey: 'MOVE_INTO_OWN_SUBTREE',
		},
	}

	async function act({ source, testCase }: ActParams<TestDialecteConfig, TestCase>): Promise<void> {
		const refused = await source
			.transaction(async (tx) =>
				tx.move({ tagName: 'DDD_2', id: 'y' } as never, {
					parent: { tagName: 'DDD_2', id: 'z' } as never,
				}),
			)
			.then(
				() => undefined,
				(error: unknown) => error,
			)
		expect(toDialecteError(refused)?.key).toBe(testCase.expectedKey)
		const deepest = await source.query.getRecord({ tagName: 'DDD_2', id: 'z' })
		expect(deepest?.parent?.id).toBe('y')
	}

	runTransparentCases.withoutExport({ testCases, act: act as never })
})
