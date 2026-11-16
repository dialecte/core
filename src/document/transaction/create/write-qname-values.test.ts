import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const EXT_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const DEFAULT_URI = DIALECTE_TEST_NAMESPACES.default.uri
const XSD_URI = 'http://www.w3.org/2001/XMLSchema'
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`

/** The document every case starts from: an E holding one EE_1 and one EE_2. */
const sourceXml = /* xml */ `
	<Root ${ns}>
		<E ${customId}="e" aE="e">
			<EE_1 ${customId}="ee1" aEE_1="Thing"/>
			<EE_2 ${customId}="ee2" aEE_2="12">Kind</EE_2>
		</E>
	</Root>
`

type Source = ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
type Tx = Parameters<Parameters<Source['transaction']>[0]>[0]
type Outcome = { key?: string; staged: number; stored?: string }

/** What a write leaves: the refusal key and the staged operations, or the value it stored on the record it wrote. */
async function outcomeOf(params: {
	source: Source
	write: (tx: Tx) => Promise<unknown>
	read: { tagName: 'EE_1' | 'EE_2'; attribute?: string }
}): Promise<Outcome> {
	const { source, write, read } = params
	let outcome: Outcome = { staged: 0 }
	let writtenId: string | undefined
	await source.transaction(async (tx) => {
		const thrown = await write(tx).then(
			(written) => {
				writtenId = (written as { id?: string } | undefined)?.id
				return undefined
			},
			(error: unknown) => error,
		)
		outcome = { key: toDialecteError(thrown)?.key, staged: tx.getStagedOperations().length }
	})
	if (outcome.key !== undefined) return outcome
	const records = await source.query.getRecordsByTagName(read.tagName)
	const record = records.find((candidate) => candidate.id === writtenId)
	const stored =
		read.attribute === undefined
			? record?.value
			: record?.attributes.find((attribute) => attribute.name === read.attribute)?.value
	return { staged: 0, stored: stored === undefined ? undefined : String(stored) }
}

type WriteCase = BaseXmlTestCase & {
	write: (tx: Tx) => Promise<unknown>
	read: { tagName: 'EE_1' | 'EE_2'; attribute?: string }
	expected: Outcome
}

describe('write - QName-typed values', () => {
	const testCases: TestCases<WriteCase> = {
		'addChild EE_1 with aEE_1 xs:integer → stored xs:integer': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: 'xs:integer' } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'xs:integer' },
		},
		'addChild EE_1 with a Clark name of the ext namespace → stored ext:local': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: `{${EXT_URI}}Thing` } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'ext:Thing' },
		},
		'addChild EE_1 with a Clark name of XSD → stored xs:local': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: `{${XSD_URI}}integer` } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'xs:integer' },
		},
		'addChild EE_1 with a QName of the xml prefix → stored xml:local': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: 'xml:lang' } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'xml:lang' },
		},
		'addChild EE_1 with the Clark name of an XML-namespace name → stored xml:local': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: '{http://www.w3.org/XML/1998/namespace}lang' } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'xml:lang' },
		},
		'addChild EE_1 with a foreign Clark name → stored as given': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: '{urn:f}Thing' } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: '{urn:f}Thing' },
		},
		'addChild EE_1 with a prefix outside the engine table → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_1', attributes: { aEE_1: 'u:Thing' } },
					),
				read: { tagName: 'EE_1', attribute: 'aEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'addChild EE_1 with a malformed Clark name → UNKNOWN_NAMESPACE_PREFIX, nothing staged': {
			sourceXml,
			write: (tx) =>
				tx.addChild(
					{ tagName: 'E', id: 'e' },
					{ tagName: 'EE_1', attributes: { aEE_1: '{urn:f' } },
				),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
		},
		'addChild EE_1 with a Clark name of the ext namespace and no local name → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_1', attributes: { aEE_1: `{${EXT_URI}}` } },
					),
				read: { tagName: 'EE_1', attribute: 'aEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'addChild EE_1 with a Clark name of the default namespace and no local name → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_1', attributes: { aEE_1: `{${DEFAULT_URI}}` } },
					),
				read: { tagName: 'EE_1', attribute: 'aEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'addChild EE_1 with a config prefix and no local name (ext:) → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_1', attributes: { aEE_1: 'ext:' } },
					),
				read: { tagName: 'EE_1', attribute: 'aEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'addChild EE_1 with an empty prefix (:x) → UNKNOWN_NAMESPACE_PREFIX, nothing staged': {
			sourceXml,
			write: (tx) =>
				tx.addChild({ tagName: 'E', id: 'e' }, { tagName: 'EE_1', attributes: { aEE_1: ':x' } }),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
		},
		'addChild EE_1 with a QName list holding an unknown prefix → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_1', attributes: { aEE_1: 'Thing', 'ext:cEE_1': 'xs:integer u:a' } },
					),
				read: { tagName: 'EE_1', attribute: 'ext:cEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'addChild EE_2 with QName text holding an unknown prefix → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.addChild(
						{ tagName: 'E', id: 'e' },
						{ tagName: 'EE_2', attributes: { aEE_2: '12' }, value: 'u:Kind' },
					),
				read: { tagName: 'EE_2' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'update EE_1 aEE_1 to a Clark name of XSD → stored xs:local': {
			sourceXml,
			write: (tx) =>
				tx.update({ tagName: 'EE_1', id: 'ee1' }, { attributes: { aEE_1: `{${XSD_URI}}integer` } }),
			read: { tagName: 'EE_1', attribute: 'aEE_1' },
			expected: { staged: 0, stored: 'xs:integer' },
		},
		'update EE_1 aEE_1 to a prefix outside the engine table → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) =>
					tx.update({ tagName: 'EE_1', id: 'ee1' }, { attributes: { aEE_1: 'u:Thing' } }),
				read: { tagName: 'EE_1', attribute: 'aEE_1' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
		'update EE_2 text to a prefix outside the engine table → UNKNOWN_NAMESPACE_PREFIX, nothing staged':
			{
				sourceXml,
				write: (tx) => tx.update({ tagName: 'EE_2', id: 'ee2' }, { value: 'u:Kind' }),
				read: { tagName: 'EE_2' },
				expected: { key: 'UNKNOWN_NAMESPACE_PREFIX', staged: 0 },
			},
	}

	runTestCases.withoutExport<WriteCase>({
		testCases,
		act: async ({ source, testCase }) => {
			await expect(
				outcomeOf({ source, write: testCase.write, read: testCase.read }),
			).resolves.toEqual(testCase.expected)
		},
	})
})

describe('deepClone - a QName value kept as written by the import', () => {
	type CloneCase = BaseXmlTestCase & { expectedStored: string[] }

	const testCases: TestCases<CloneCase> = {
		'an EE_1 holding u:Thing (u bound nowhere), cloned under an empty E → the clone holds u:Thing':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<E ${customId}="src" aE="source"><EE_1 ${customId}="s" aEE_1="u:Thing"/></E>
					<E ${customId}="dst" aE="target"/>
				</Root>
			`,
				expectedStored: ['u:Thing', 'u:Thing'],
			},
	}

	runTestCases.withoutExport<CloneCase>({
		testCases,
		act: async ({ source, testCase }) => {
			const tree = await source.query.getTree({ tagName: 'EE_1', id: 's' })
			let refusedKey: string | undefined
			await source.transaction(async (tx) => {
				const thrown = await Promise.resolve(
					tree ? tx.deepClone({ tagName: 'E', id: 'dst' }, tree) : undefined,
				).catch((error: unknown) => error)
				refusedKey = toDialecteError(thrown)?.key
			})
			const records = await source.query.getRecordsByTagName('EE_1')
			const stored = records.map(
				(record) => record.attributes.find((attribute) => attribute.name === 'aEE_1')?.value,
			)
			expect({ refusedKey, stored }).toEqual({
				refusedKey: undefined,
				stored: testCase.expectedStored,
			})
		},
	})
})
