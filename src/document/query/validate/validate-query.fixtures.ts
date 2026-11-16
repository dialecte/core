import { expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { TEST_DIALECTE_CONFIG } from '@/test'

import type { IssueCase, ThrowCase } from './validate-query.fixtures.types'
import type { Document } from '@/document'
import type { TestDialecteConfig } from '@/test'

/** The act of a case that returns an issue (or none). */
export async function actIssue(params: {
	source: Document<TestDialecteConfig>
	testCase: IssueCase
}): Promise<void> {
	const { source, testCase } = params
	const { check, expected } = testCase
	const issue = await check(source)
	expect(issue).toEqual(expected)
}

/** The act of a case that throws: the key of the error. */
export async function actThrows(params: {
	source: Document<TestDialecteConfig>
	testCase: ThrowCase
}): Promise<void> {
	const { source, testCase } = params
	const { check, expectedError } = testCase
	const outcome = await check(source).then(
		() => undefined,
		(error: unknown) => toDialecteError(error)?.key ?? error,
	)
	expect(outcome).toEqual(expectedError)
}

/** What the write path does with attributes: add a `tagName` child carrying them under AAA_1 (aaa1). */
export async function writeAttributes(params: {
	document: Document<TestDialecteConfig>
	tagName: string
	attributes: unknown
}): Promise<undefined> {
	const { document, tagName, attributes } = params
	await document.transaction(async (tx) => {
		await tx.any.addChild({ tagName: 'AAA_1', id: 'aaa1' }, { tagName, attributes } as never)
	})
	return undefined
}

/** The full-object form of one attribute on the write path. */
export function writeAttribute(params: {
	document: Document<TestDialecteConfig>
	tagName: string
	attribute: { name: string; value: string; namespace?: unknown }
}): Promise<undefined> {
	const { document, tagName, attribute } = params
	return writeAttributes({ document, tagName, attributes: [attribute] })
}

/** The test dialecte with AAAA_2.aAAAA_2 a QName under `facets`. */
export function withQNameAAAA_2(facets?: { enumeration: string[] }): TestDialecteConfig {
	const { definition } = TEST_DIALECTE_CONFIG
	return {
		...TEST_DIALECTE_CONFIG,
		definition: {
			...definition,
			AAAA_2: {
				...definition.AAAA_2,
				attributes: {
					...definition.AAAA_2.attributes,
					details: {
						...definition.AAAA_2.attributes.details,
						aAAAA_2: { required: true, type: { builtin: 'QName', ...(facets ? { facets } : {}) } },
					},
				},
			},
		},
	} as unknown as TestDialecteConfig
}

/** The store reads the validation made since the last reset: every `core::store::*` read counter (not the writes). */
export function storeReads(document: Document<TestDialecteConfig>): number {
	return Object.entries(document.perf.report())
		.filter(
			([key]) =>
				key.startsWith('core::store::') &&
				!['core::store::commit', 'core::store::bulkWrite'].includes(key),
		)
		.reduce((total, [, entry]) => total + (entry.count ?? 0), 0)
}
