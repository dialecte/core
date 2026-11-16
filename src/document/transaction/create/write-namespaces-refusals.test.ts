import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, XMLNS_XSI_NAMESPACE, XSI_NAMESPACE } from '@/helpers/constant'
import {
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}`

/** The document every case starts from: a D with no child. */
const createSource = /* xml */ `
	<Root ${ns}>
		<D ${customId}="d" aD="d"/>
	</Root>
`

type Tx = Parameters<
	Parameters<ActParams<TestDialecteConfig, BaseXmlTestCase>['source']['transaction']>[0]
>[0]
type Refusal = { key?: string; staged: ReadonlyArray<unknown> }

/**
 * Run a write that is refused, inside a transaction: catch it there and read what it left (its key and the staged
 * operations); the test asserts it after the transaction, so a failed assertion stays an assertion.
 */
async function captureRefusal(params: {
	source: ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
	write: (tx: Tx) => Promise<unknown>
}): Promise<Refusal> {
	let refusal: Refusal = { staged: [] }
	await params.source.transaction(async (tx) => {
		const thrown = await params.write(tx).catch((error: unknown) => error)
		refusal = { key: toDialecteError(thrown)?.key, staged: tx.getStagedOperations() }
	})
	return refusal
}

type RefusedCase = BaseXmlTestCase & {
	tagName: string
	attributes: { name: string; value: string; namespace?: { prefix: string; uri: string } }[]
	expectedKey: string
}

describe('write - a refused attribute on an addChild', () => {
	const testCases: TestCases<RefusedCase> = {
		'a malformed Clark xsi:type {urn:f on an undeclared tag → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml: createSource,
				tagName: 'Undeclared',
				attributes: [
					{ name: 'aDD_2', value: 'p' },
					{ name: 'type', value: '{urn:f', namespace: XSI_NAMESPACE },
				],
				expectedKey: 'UNKNOWN_NAMESPACE_PREFIX',
				expectedQueries: ['//default:D[@aD="d"]'],
				unexpectedQueries: ['//default:DD_2'],
			},
		'an attribute whose namespace object is the xmlns prefix on another URI → NAMESPACE_DECLARATION_NOT_ALLOWED, nothing staged':
			{
				sourceXml: createSource,
				tagName: 'DD_2',
				attributes: [
					{ name: 'aDD_2', value: 'p' },
					{ name: 'g', value: 'urn:g', namespace: { prefix: 'xmlns', uri: 'urn:other' } },
				],
				expectedKey: 'NAMESPACE_DECLARATION_NOT_ALLOWED',
				expectedQueries: ['//default:D[@aD="d"]'],
				unexpectedQueries: ['//default:DD_2'],
			},
	}

	runTestCases.withExport<RefusedCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const refusal = await captureRefusal({
				source,
				write: (tx) =>
					// a tag outside the typed definition and plain-string attributes: no typed overload takes them
					tx.addChild({ tagName: 'D', id: 'd' }, {
						tagName: testCase.tagName,
						attributes: testCase.attributes,
					} as never),
			})
			expect(refusal.key).toBe(testCase.expectedKey)
			expect(refusal.staged).toEqual([])
			return {}
		},
	})
})
