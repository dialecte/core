import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_DEFAULT_NAMESPACE, XMLNS_DEV_NAMESPACE, runTestCases } from '@/test'

import type { Transaction } from '@/document'
import type { ActParams, ActResult, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

describe('a staged write holding a character XML does not allow', () => {
	const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
	const customId = CUSTOM_RECORD_ID_ATTRIBUTE

	type TestCase = BaseXmlTestCase & {
		write: (tx: Transaction<TestDialecteConfig>) => Promise<unknown>
		/** The refusal's `meta`, when the write is refused */
		refused?: Record<string, unknown>
	}

	const testCases: TestCases<TestCase> = {
		'an update setting a value holding a vertical tab → XML_CHARACTER_NOT_ALLOWED, nothing written':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x">kept</A>
				</Root>
			`,
				write: function updateValue(tx) {
					return tx.update({ tagName: 'A', id: 'a1' }, { value: 'x\u{B}' })
				},
				refused: { recordId: 'a1', tagName: 'A', part: 'value', character: 'U+000B' },
				expectedQueries: ['//default:A[@aA="x"][text()="kept"]'],
			},
		'an update setting an attribute value holding a form feed → refused, naming the attribute': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function updateAttribute(tx) {
				return tx.update({ tagName: 'A', id: 'a1' }, { attributes: { aA: '\u{C}' } })
			},
			refused: {
				recordId: 'a1',
				tagName: 'A',
				attribute: 'aA',
				part: 'value',
				character: 'U+000C',
			},
			expectedQueries: ['//default:A[@aA="x"]'],
		},
		'a child added with an attribute value holding U+FFFE → refused, no child': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildAttribute(tx) {
				return tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{
						id: '00000000-0000-4000-8000-000000000001',
						tagName: 'AA_1',
						attributes: { aAA_1: 'y\u{FFFE}' },
					},
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000001',
				tagName: 'AA_1',
				attribute: 'aAA_1',
				part: 'value',
				character: 'U+FFFE',
			},
			unexpectedQueries: ['//default:AA_1'],
		},
		'a child added with a value holding NUL → refused, no child': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildValue(tx) {
				return tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{
						id: '00000000-0000-4000-8000-000000000002',
						tagName: 'AA_1',
						attributes: { aAA_1: 'y' },
						value: '\u{0}',
					},
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000002',
				tagName: 'AA_1',
				part: 'value',
				character: 'U+0000',
			},
			unexpectedQueries: ['//default:AA_1'],
		},
		'a child added with an attribute in a namespace whose URI holds a vertical tab → refused, naming it':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
				write: function addChildNamespacedAttribute(tx) {
					return tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{
							id: '00000000-0000-4000-8000-000000000003',
							tagName: 'AA_1',
							attributes: [
								{ name: 'aAA_1', value: 'y' },
								{ name: 'a', value: 'v', namespace: { prefix: 'x', uri: 'urn:\u{B}' } },
							],
						},
					)
				},
				refused: {
					recordId: '00000000-0000-4000-8000-000000000003',
					tagName: 'AA_1',
					attribute: 'x:a',
					part: 'namespace',
					character: 'U+000B',
				},
				unexpectedQueries: ['//default:AA_1'],
			},
		'a child added in a namespace whose URI holds a form feed → refused, naming the namespace': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildNamespacedElement(tx) {
				return tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{
						id: '00000000-0000-4000-8000-000000000004',
						tagName: 'AA_1',
						namespace: { prefix: 'y', uri: 'urn:\u{C}' },
						attributes: { aAA_1: 'y' },
					},
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000004',
				tagName: 'AA_1',
				part: 'namespace',
				character: 'U+000C',
			},
			unexpectedQueries: ['//default:AA_1'],
		},
		'a child added with an attribute whose name holds a vertical tab → refused, naming the name': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildAttributeName(tx) {
				return tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{
						id: '00000000-0000-4000-8000-000000000005',
						tagName: 'AA_1',
						attributes: [
							{ name: 'aAA_1', value: 'y' },
							{ name: 'a\u{B}', value: 'v', namespace: { prefix: 'x', uri: 'urn:y' } },
						],
					},
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000005',
				tagName: 'AA_1',
				attribute: 'x:a\u{B}',
				part: 'name',
				character: 'U+000B',
			},
			unexpectedQueries: ['//default:AA_1'],
		},
		'a child added with an attribute whose prefix holds a vertical tab → refused, naming the prefix':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
				write: function addChildAttributePrefix(tx) {
					return tx.addChild(
						{ tagName: 'A', id: 'a1' },
						{
							id: '00000000-0000-4000-8000-000000000006',
							tagName: 'AA_1',
							attributes: [
								{ name: 'aAA_1', value: 'y' },
								{ name: 'a', value: 'v', namespace: { prefix: 'x\u{B}', uri: 'urn:y' } },
							],
						},
					)
				},
				refused: {
					recordId: '00000000-0000-4000-8000-000000000006',
					tagName: 'AA_1',
					attribute: 'x\u{B}:a',
					part: 'prefix',
					character: 'U+000B',
				},
				unexpectedQueries: ['//default:AA_1'],
			},
		'a child added in a namespace whose prefix holds a vertical tab → refused, naming the prefix': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildElementPrefix(tx) {
				return tx.addChild(
					{ tagName: 'A', id: 'a1' },
					{
						id: '00000000-0000-4000-8000-000000000007',
						tagName: 'AA_1',
						namespace: { prefix: 'y\u{B}', uri: 'urn:z' },
						attributes: { aAA_1: 'y' },
					},
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000007',
				tagName: 'AA_1',
				part: 'prefix',
				character: 'U+000B',
			},
			unexpectedQueries: ['//default:AA_1'],
		},
		'a child added with a tag name holding a form feed (untyped) → refused, naming the tag name': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function addChildTagName(tx) {
				return tx.any.addChild(
					{ tagName: 'A', id: 'a1' },
					{ id: '00000000-0000-4000-8000-000000000008', tagName: 'X\u{C}', attributes: {} },
				)
			},
			refused: {
				recordId: '00000000-0000-4000-8000-000000000008',
				tagName: 'X\u{C}',
				part: 'name',
				character: 'U+000C',
			},
			expectedQueries: ['//default:A[@aA="x"][not(*)]'],
		},
		'pin, as before: an update setting a value holding a no-break space and U+2028 → written': {
			sourceXml: /* xml */ `
				<Root ${ns}>
					<A ${customId}="a1" aA="x"/>
				</Root>
			`,
			write: function updateKeptValue(tx) {
				return tx.update({ tagName: 'A', id: 'a1' }, { value: 'a\u{A0}b\u{2028}' })
			},
			expectedQueries: ['//default:A[text()="a\u{A0}b\u{2028}"]'],
		},
	}

	async function act({
		source,
		testCase,
	}: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult> {
		const transaction = source.transaction(function write(tx) {
			return testCase.write(tx)
		})
		const thrown = await transaction.then(
			function written() {
				return undefined
			},
			function refused(error: unknown) {
				return error
			},
		)
		if (!testCase.refused) {
			expect(thrown).toBeUndefined()
			return {}
		}
		const error = toDialecteError(thrown)
		expect(error?.key).toBe('XML_CHARACTER_NOT_ALLOWED')
		expect(error?.meta).toEqual(testCase.refused)
		return {}
	}

	runTestCases.withExport({ testCases, act })
})
