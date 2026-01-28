import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import { exportXmlFile, exportXmlDocumentForOpenSCD } from './main'

import Dexie from 'dexie'
import { describe, expect, it, afterAll } from 'vitest'
import xmlFormat from 'xml-formatter'

import {
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	DEV_ID,
	XMLNS_EXT_NAMESPACE,
	DIALECTE_NAMESPACES,
} from '@/helpers'
import { importXmlFiles } from '@/io/import'

import type { AnyRawRecord } from '@/types'

const databaseNames: string[] = []

afterAll(async () => {
	for (const dbName of databaseNames) {
		await Dexie.delete(dbName)
	}
})

describe('Export', () => {
	describe('Feature', () => {
		type TestCase = {
			description: string
			xml: string
			expectedXml: string
			expectedOpenScdXml: string
		}

		const tests: TestCase[] = [
			{
				description: 'simple document',
				xml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A aA="value aA" ${DEV_ID}="2"/></Root>
				`,
				expectedXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="value aA"/></Root>
				`,
				expectedOpenScdXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${TEMP_IDB_ID_ATTRIBUTE_NAME}="1"><A aA="value aA" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="2"/></Root>`,
			},
			{
				description: 'children ordering',
				xml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A aA="value aA" ${DEV_ID}="2"><AA_1 aAA_1="value aa1" ${DEV_ID}="3"/><AA_2 aAA_2="value aa2" ${DEV_ID}="4"/></A></Root>
				`,
				expectedXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="value aA"><AA_1 aAA_1="value aa1"/><AA_2 aAA_2="value aa2"/></A></Root>
				`,
				expectedOpenScdXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${TEMP_IDB_ID_ATTRIBUTE_NAME}="1"><A aA="value aA" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="2"><AA_1 aAA_1="value aa1" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="3"/><AA_2 aAA_2="value aa2" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="4"/></A></Root>`,
			},
			{
				description: 'same attribute with two different namespaces',
				xml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${DEV_ID}="1"><A aA="value aA" ext:cA="value cA" ${DEV_ID}="2"/></Root>
				`,
				expectedXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_EXT_NAMESPACE}><A aA="value aA" ext:cA="value cA"/></Root>
				`,
				expectedOpenScdXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${TEMP_IDB_ID_ATTRIBUTE_NAME}="1" ${XMLNS_EXT_NAMESPACE}><A aA="value aA" ext:cA="value cA" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="2"/></Root>`,
			},
			{
				description: 'namespace element',
				xml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${DEV_ID}="1"><ext:AA_3 aAA_3="value aAA_3" ${DEV_ID}="2"/></Root>
				`,
				expectedXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_EXT_NAMESPACE}><ext:AA_3 aAA_3="value aAA_3"/></Root>
				`,
				expectedOpenScdXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${TEMP_IDB_ID_ATTRIBUTE_NAME}="1" ${XMLNS_EXT_NAMESPACE}><ext:AA_3 aAA_3="value aAA_3" ${TEMP_IDB_ID_ATTRIBUTE_NAME}="2"/></Root>`,
			},
		]

		tests.forEach(({ description, xml, expectedXml, expectedOpenScdXml }) => {
			it(description, async () => {
				// Import XML with custom IDs
				// Generate unique filename per test execution to avoid Dexie log warnings
				const filename = `${description.replace(/\s+/g, '-')}-${crypto.randomUUID()}.xml`
				const file = new File([xml], filename, {
					type: 'text/xml',
				})
				const [databaseName] = await importXmlFiles({
					files: [file],
					dialecteConfig: TEST_DIALECTE_CONFIG,
					useCustomRecordsIds: true,
				})

				// Export regular
				const exported = await exportXmlFile({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })
				const exportedString = new XMLSerializer().serializeToString(exported.xmlDocument)
				expect(xmlFormat(exportedString)).toBe(xmlFormat(expectedXml))

				// Export for OpenSCD
				const exportedOpenScd = await exportXmlDocumentForOpenSCD({
					databaseName,
					dialecteConfig: TEST_DIALECTE_CONFIG,
				})
				const exportedOpenScdString = new XMLSerializer().serializeToString(
					exportedOpenScd.xmlDocument,
				)
				expect(xmlFormat(exportedOpenScdString)).toBe(xmlFormat(expectedOpenScdXml))

				// Collect database for cleanup
				databaseNames.push(databaseName)
			})
		})

		type CorruptionTestCase = {
			description: string
			data: AnyRawRecord[]
			expectedError: string
		}

		const corruptionTests: CorruptionTestCase[] = [
			{
				description: 'parent references single non-existent child',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'version', value: '1.0' }],
						parent: null,
						children: [
							{ id: '2', tagName: 'A' },
							{ id: '3', tagName: 'A' }, // Missing!
						],
					},
					{
						id: '2',
						tagName: 'A',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'name', value: 'ExistingA' }],
						parent: { id: '1', tagName: 'Root' },
						children: [],
					},
				],
				expectedError:
					"Database corruption detected: Parent element 'Root' (id: 1) references 1 non-existent child record(s): 'A' (id: 3)",
			},
			{
				description: 'parent references multiple non-existent children',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'version', value: '1.0' }],
						parent: null,
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: { id: '1', tagName: 'Root' },
						children: [
							{ id: '3', tagName: 'B' },
							{ id: '4', tagName: 'B' }, // Missing!
							{ id: '5', tagName: 'B' }, // Missing!
						],
					},
					{
						id: '3',
						tagName: 'B',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: { id: '2', tagName: 'A' },
						children: [],
					},
				],
				expectedError:
					"Database corruption detected: Parent element 'A' (id: 2) references 2 non-existent child record(s): 'B' (id: 4), 'B' (id: 5)",
			},
		]

		corruptionTests.forEach(({ description, data, expectedError }) => {
			it(description, async () => {
				const databaseName = `corruption-${description.replace(/\s+/g, '-')}-${crypto.randomUUID()}`

				await writeToDatabase(databaseName, data)

				await expect(
					exportXmlFile({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG }),
				).rejects.toThrowError(expectedError)

				databaseNames.push(databaseName)
			})
		})
	})

	describe('Malformed data resilience', () => {
		type MalformedDataTestCase = {
			description: string
			data: AnyRawRecord[]
			expectedContains: string[]
			expectedNotContains: string[]
		}

		const malformedTests: MalformedDataTestCase[] = [
			{
				description: 'element with xmlns prefix in namespace object',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: null,
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						namespace: { prefix: 'xmlns', uri: 'http://malformed.com' }, // Malformed!
						value: '',
						attributes: [],
						parent: { id: '1', tagName: 'Root' },
						children: [],
					},
				],
				expectedContains: ['<A'],
				expectedNotContains: ['xmlns:A', ':A'],
			},
			{
				description: 'xmlns attribute stored by extension',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: null,
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [
							{ name: 'xmlns', value: 'http://should-be-filtered.com' }, // Should be filtered!
							{ name: 'xmlns:bad', value: 'http://also-filtered.com' }, // Should be filtered!
							{ name: 'data', value: 'valid' }, // Should be kept
						],
						parent: { id: '1', tagName: 'Root' },
						children: [],
					},
				],
				expectedContains: ['data="valid"'],
				expectedNotContains: ['xmlns="http://should-be-filtered.com"', 'xmlns:bad'],
			},
			{
				description: 'qualified xmlns attribute stored by extension',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: null,
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [
							{
								name: 'dev',
								value: 'http://malformed.com',
								namespace: { prefix: 'xmlns', uri: 'http://www.w3.org/2000/xmlns/' },
							}, // Should be filtered!
							{ name: 'valid', value: 'data' }, // Should be kept
						],
						parent: { id: '1', tagName: 'Root' },
						children: [],
					},
				],
				expectedContains: ['valid="data"'],
				expectedNotContains: ['xmlns:dev'],
			},
			{
				description: 'empty prefix in non-default namespace',
				data: [
					{
						id: '1',
						tagName: 'Root',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [],
						parent: null,
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						// Malformed: non-default namespace with empty prefix
						namespace: { prefix: '', uri: 'http://different-namespace.com' },
						value: '',
						attributes: [],
						parent: { id: '1', tagName: 'Root' },
						children: [],
					},
				],
				expectedContains: ['<A'],
				expectedNotContains: [],
			},
		]

		malformedTests.forEach(({ description, data, expectedContains, expectedNotContains }) => {
			it(description, async () => {
				const databaseName = `malformed-${description.replace(/\s+/g, '-')}-${crypto.randomUUID()}`

				await writeToDatabase(databaseName, data)

				// Should not throw - defensive code handles malformed data
				const exported = await exportXmlFile({ databaseName, dialecteConfig: TEST_DIALECTE_CONFIG })
				const xmlString = new XMLSerializer().serializeToString(exported.xmlDocument)

				// Verify expected content
				expectedContains.forEach((expected) => {
					expect(xmlString).toContain(expected)
				})

				expectedNotContains.forEach((notExpected) => {
					expect(xmlString).not.toContain(notExpected)
				})

				databaseNames.push(databaseName)
			})
		})
	})
})

async function writeToDatabase(databaseName: string, records: AnyRawRecord[]) {
	const { createDatabaseInstance } = await import('@/database')
	const databaseInstance = await createDatabaseInstance({
		databaseName,
		dialecteConfig: TEST_DIALECTE_CONFIG,
	})

	const currentTable = databaseInstance.table(TEST_DIALECTE_CONFIG.database.tables.xmlElements.name)
	await databaseInstance.transaction('rw', currentTable, async () => {
		return currentTable.bulkAdd(records)
	})
	databaseInstance.close()
}
