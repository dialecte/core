import { describe, expect } from 'vitest'

import { toDialecteError } from '@/errors'
import { CUSTOM_RECORD_ID_ATTRIBUTE, XMLNS_XSI_NAMESPACE } from '@/helpers/constant'
import {
	runTestCases,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
} from '@/test'
import { withXmlDocument } from '@/test/xml'
import { isXsiTypeAttribute } from '@/utils/xsi-type'

import type { ActParams, BaseXmlTestCase, TestCases, TestDialecteConfig } from '@/test'

const customId = CUSTOM_RECORD_ID_ATTRIBUTE
const ns = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${XMLNS_XSI_NAMESPACE}`

type StoredCase = BaseXmlTestCase & { expectedStored: (string | undefined)[] }

/** The xsi:type values the document's DDD_2 records store, in store order. */
async function storedXsiTypes(params: {
	source: ActParams<TestDialecteConfig, BaseXmlTestCase>['source']
}): Promise<(string | undefined)[]> {
	const records = await params.source.query.getRecordsByTagName('DDD_2')
	return records.map((record) => {
		const value = record.attributes.find(isXsiTypeAttribute)?.value
		return typeof value === 'string' ? value : undefined
	})
}

describe('deepClone - stored xsi:type values', () => {
	const cloneCases: TestCases<StoredCase> = {
		'a DDD_2 holding a stored xs:integer, cloned under another DD_2 of the same document → the clone holds xs:integer':
			{
				sourceXml: /* xml */ `
					<Root ${ns} xmlns:xs="http://www.w3.org/2001/XMLSchema">
						<D ${customId}="src" aD="source">
							<DD_2 aDD_2="p">
								<DDD_2 ${customId}="s" xsi:type="xs:integer"/>
							</DD_2>
						</D>
						<D ${customId}="other" aD="target">
							<DD_2 ${customId}="dst" aDD_2="q"/>
						</D>
					</Root>
				`,
				expectedStored: ['xs:integer', 'xs:integer'],
			},
	}

	runTestCases.withoutExport<StoredCase>({
		testCases: cloneCases,
		act: async ({ source, testCase }) => {
			const tree = await source.query.getTree({ tagName: 'DDD_2', id: 's' })
			await source.transaction(async (tx) => {
				if (tree) await tx.deepClone({ tagName: 'DD_2', id: 'dst' }, tree)
			})
			const stored = await storedXsiTypes({ source })
			expect(stored).toEqual(testCase.expectedStored)
		},
	})
})

describe('deepClone - into another document', () => {
	const cloneCases: TestCases<StoredCase> = {
		'a DDD_2 holding a stored xs:integer, cloned into a second document → the clone holds xs:integer, the export parses':
			{
				sourceXml: /* xml */ `
					<Root ${ns} xmlns:xs="http://www.w3.org/2001/XMLSchema">
						<D ${customId}="src" aD="source">
							<DD_2 aDD_2="p">
								<DDD_2 ${customId}="s" xsi:type="xs:integer"/>
							</DD_2>
						</D>
					</Root>
				`,
				targetXml: /* xml */ `
					<Root ${ns}>
						<D ${customId}="other" aD="target">
							<DD_2 ${customId}="dst" aDD_2="q"/>
						</D>
					</Root>
				`,
				expectedStored: ['xs:integer'],
			},
	}

	runTestCases.withoutExport<StoredCase>({
		testCases: cloneCases,
		act: async ({ project, source, target, testCase }) => {
			if (target === undefined) throw new Error('the case holds a targetXml')
			const tree = await source.query.getTree({ tagName: 'DDD_2', id: 's' })
			await target.transaction(async (tx) => {
				if (tree) await tx.deepClone({ tagName: 'DD_2', id: 'dst' }, tree)
			})
			const stored = await storedXsiTypes({ source: target })
			expect(stored).toEqual(testCase.expectedStored)

			// the second document's export must parse: a prefix bound nowhere is a namespace error
			const { file } = await project.export({ documentId: target.documentId, indent: false })
			const xml = await file.text()
			const parsed = withXmlDocument({ xml, label: 'the second document' }, (document) => document)
			expect(parsed).toBeDefined()
		},
	})
})

describe('deepClone - a value kept as written by the import', () => {
	type KeptCase = BaseXmlTestCase & { expectedStored: (string | undefined)[] }

	const cloneCases: TestCases<KeptCase> = {
		'a foreign X holding t:Kind (t bound nowhere), cloned under another DDD_2 → the clone holds t:Kind':
			{
				sourceXml: /* xml */ `
				<Root ${ns}>
					<D aD="source">
						<DD_2 aDD_2="p">
							<DDD_2>
								<f:X xmlns:f="urn:f" ${customId}="s" xsi:type="t:Kind"/>
							</DDD_2>
						</DD_2>
					</D>
					<D aD="target">
						<DD_2 aDD_2="q">
							<DDD_2 ${customId}="dst"/>
						</DD_2>
					</D>
				</Root>
			`,
				expectedStored: ['t:Kind', 't:Kind'],
			},
	}

	runTestCases.withoutExport<KeptCase>({
		testCases: cloneCases,
		act: async ({ source, testCase }) => {
			// the tag is outside the typed definition: no typed ref takes it
			const sourceRef = { tagName: 'X', id: 's' } as never
			const tree = await source.query.getTree(sourceRef)
			let refusedKey: string | undefined
			await source.transaction(async (tx) => {
				const thrown = await Promise.resolve(
					tree ? tx.deepClone({ tagName: 'DDD_2', id: 'dst' }, tree as never) : undefined,
				).catch((error: unknown) => error)
				refusedKey = toDialecteError(thrown)?.key
			})
			const records = await source.query.getRecordsByTagName('X' as never)
			const stored = records.map((record) => record.attributes.find(isXsiTypeAttribute)?.value)
			expect({ refusedKey, stored }).toEqual({
				refusedKey: undefined,
				stored: testCase.expectedStored,
			})
		},
	})
})
