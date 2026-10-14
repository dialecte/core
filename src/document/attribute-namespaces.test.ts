import { describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { XMLNS_XSI_NAMESPACE } from '@/helpers/constant'
import {
	DIALECTE_TEST_NAMESPACES,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	runTestCases,
} from '@/test'
import { invariant } from '@/utils'

import type { ActParams, ActResult, BaseXmlTestCase, TestDialecteConfig } from '@/test'

// Every method over the same attributes, end to end: one of the default namespace (`aA`), one of a namespace the
// dialecte declares (`ext:cA` - written `x:cA` by a2's document), one of a namespace it does not (`foo:bar`), and one
// local name in two namespaces (`root`, `ext:root`).
const id = CUSTOM_RECORD_ID_ATTRIBUTE
const sourceXml = /* xml */ `
	<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}
		xmlns:foo="urn:foo" xmlns:x="${DIALECTE_TEST_NAMESPACES.ext.uri}" ${id}="root" root="r" ext:root="er">
		<A ${id}="a1" aA="plain" ext:cA="qualified" foo:bar="foreign" />
		<A ${id}="a2" aA="other" x:cA="other-prefix" />
	</Root>
`

/** The document as export writes it, serialized. */
async function exported(params: {
	project: ActParams<TestDialecteConfig, TestCase>['project']
	documentId: string
}): Promise<string> {
	const { xmlDocument } = await params.project.export(params.documentId)
	return new XMLSerializer().serializeToString(xmlDocument)
}

type TestCase = BaseXmlTestCase & {
	run: (params: ActParams<TestDialecteConfig, TestCase>) => Promise<ActResult | void>
}

describe('attributes of every namespace, end to end', () => {
	const testCases: Record<string, TestCase> = {
		'read: each attribute under the name it is stored by, a foreign one under the document prefix':
			{
				sourceXml,
				run: async ({ source }) => {
					expect(await source.query.getAttributes({ tagName: 'A', id: 'a1' })).toEqual({
						aA: 'plain',
						'ext:cA': 'qualified',
						'foo:bar': 'foreign',
					})
					expect(await source.query.getAttributes({ tagName: 'Root', id: 'root' })).toEqual({
						root: 'r',
						'ext:root': 'er',
					})
				},
			},
		"read: a dialecte namespace written with another prefix -> under the dialecte's": {
			sourceXml,
			run: async ({ source }) => {
				expect(await source.query.getAttributes({ tagName: 'A', id: 'a2' })).toEqual({
					aA: 'other',
					'ext:cA': 'other-prefix',
				})
			},
		},
		'read one: by its stored name, or by local name in its namespace scope': {
			sourceXml,
			run: async ({ source }) => {
				const a1 = { tagName: 'A', id: 'a1' } as const
				expect(await source.query.getAttribute(a1, { name: 'ext:cA' })).toBe('qualified')
				expect(await source.query.getAttribute(a1, { name: 'cA', namespace: 'ext' })).toBe(
					'qualified',
				)
				expect(await source.query.getAttributes(a1, { namespace: 'ext' })).toEqual({
					cA: 'qualified',
				})
			},
		},
		'find: by a namespaced attribute, whatever prefix the document wrote': {
			sourceXml,
			run: async ({ source }) => {
				const found = await source.query.findByAttributes({
					tagName: 'A',
					attributes: { 'ext:cA': ['qualified', 'other-prefix'] },
				})
				expect(found.map((record) => record.id).sort()).toEqual(['a1', 'a2'])
			},
		},
		'update: a namespaced attribute by its stored name, the same local name in another namespace untouched':
			{
				sourceXml,
				run: async ({ source }) => {
					await source.transaction(async (tx) => {
						await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { 'ext:cA': 'changed' } })
						await tx.update({ tagName: 'Root', id: 'root' }, { attributes: { 'ext:root': 'er2' } })
					})
				},
				expectedQueries: [
					'//default:A[@aA="plain"][@ext:cA="changed"]',
					'//default:Root[@root="r"][@ext:root="er2"]',
				],
			},
		'update: clearing a namespaced attribute': {
			sourceXml,
			run: async ({ source }) => {
				await source.transaction(async (tx) => {
					await tx.update({ tagName: 'A', id: 'a1' }, { attributes: { 'ext:cA': undefined } })
				})
			},
			expectedQueries: ['//default:A[@aA="plain"]'],
			unexpectedQueries: ['//default:A[@aA="plain"][@ext:cA]'],
		},
		'update: a foreign attribute by its stored name': {
			sourceXml,
			run: async ({ source, project }) => {
				await source.transaction(async (tx) => {
					await tx.update(
						{ tagName: 'A', id: 'a1' },
						{ attributes: { 'foo:bar': 'changed' } as {} },
					)
				})
				const xmlString = await exported({ project, documentId: source.documentId })
				expect(xmlString).toContain('foo:bar="changed"')
			},
		},
		'write back what was read: addChild takes the object getAttributes returned': {
			sourceXml,
			run: async ({ source, project }) => {
				const read = await source.query.getAttributes({ tagName: 'A', id: 'a2' })
				await source.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'Root', id: 'root' },
						{ tagName: 'A', attributes: { ...read, aA: 'copy' } },
					)
				})
				const xmlString = await exported({ project, documentId: source.documentId })
				expect(xmlString).toMatch(
					/<A [^>]*aA="copy"[^>]*ext:cA="other-prefix"|<A [^>]*ext:cA="other-prefix"[^>]*aA="copy"/,
				)
			},
		},
		'addChild: a foreign attribute by its prefixed name -> refused, no record says what the prefix means':
			{
				sourceXml,
				run: async ({ source }) => {
					const transaction = source.transaction(async (tx) => {
						await tx.addChild(
							{ tagName: 'Root', id: 'root' },
							{ tagName: 'A', attributes: { aA: 'x', 'foo:bar': 'y' } as { aA: string } },
						)
					})
					await expect(transaction).rejects.toThrow(/Unknown namespace prefix 'foo'/)
				},
			},
		'addChild: a foreign attribute by the array form, its namespace given': {
			sourceXml,
			run: async ({ source, project }) => {
				await source.transaction(async (tx) => {
					await tx.addChild(
						{ tagName: 'Root', id: 'root' },
						{
							tagName: 'A',
							attributes: [
								{ name: 'aA', value: 'x' },
								{ name: 'bar', value: 'y', namespace: { prefix: 'foo', uri: 'urn:foo' } },
							],
						},
					)
				})
				const xmlString = await exported({ project, documentId: source.documentId })
				expect(xmlString).toMatch(/<A [^>]*aA="x"[^>]*foo:bar="y"|<A [^>]*foo:bar="y"[^>]*aA="x"/)
			},
		},
		'deepClone: every attribute kept, the foreign one with its namespace': {
			sourceXml,
			run: async ({ source, project }) => {
				const tree = await source.query.getTree({ tagName: 'A', id: 'a1' })
				invariant(tree, { key: 'ELEMENT_NOT_FOUND', detail: 'a1', ref: { tagName: 'A', id: 'a1' } })
				await source.transaction(async (tx) => {
					await tx.deepClone({ tagName: 'Root', id: 'root' }, tree)
				})
				const xmlString = await exported({ project, documentId: source.documentId })
				expect(xmlString.match(/foo:bar="foreign"/g)?.length).toBe(2)
				expect(xmlString.match(/ext:cA="qualified"/g)?.length).toBe(2)
				expect(xmlString).toContain('xmlns:foo="urn:foo"')
			},
		},
		"export: the dialecte namespace under the dialecte's prefix, a foreign one under the document's, both declared":
			{
				sourceXml,
				run: async ({ source, project }) => {
					const xmlString = await exported({ project, documentId: source.documentId })
					expect(xmlString).toContain('ext:cA="other-prefix"')
					expect(xmlString).not.toContain('x:cA=')
					expect(xmlString).toContain('foo:bar="foreign"')
					expect(xmlString).toContain('xmlns:foo="urn:foo"')
					expect(xmlString).toContain(`xmlns:ext="${DIALECTE_TEST_NAMESPACES.ext.uri}"`)
				},
			},
	}

	async function act(params: ActParams<TestDialecteConfig, TestCase>): Promise<ActResult | void> {
		return params.testCase.run(params)
	}

	runTestCases.withExport({ testCases, act })
})
