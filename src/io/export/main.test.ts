import { TEMP_IDB_ID_ATTRIBUTE_NAME } from './constant'
import { exportXmlFile } from './main'

import Dexie from 'dexie'
import { afterAll, describe, expect } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import {
	DIALECTE_NAMESPACES,
	XMLNS_EXT_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	runTestCases,
} from '@/test'

import type { BaseTestCase, BaseXmlTestCase, ActResult } from '@/test'
import type { AnyRawRecord } from '@/types'

const databaseNames: string[] = []

afterAll(async () => {
	for (const dbName of databaseNames) {
		await Dexie.delete(dbName)
	}
})

describe('Export', () => {
	describe('Feature', () => {
		type TestCase = BaseXmlTestCase

		const testCases: Record<string, TestCase> = {
			'simple document': {
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
					</Root>
				`,
				expectedQueries: [
					'//default:Root[@root="1"]',
					'//default:Root/default:A[@aA="value aA"]',
					`//default:Root[@${TEMP_IDB_ID_ATTRIBUTE_NAME}="1"]`,
					`//default:Root/default:A[@${TEMP_IDB_ID_ATTRIBUTE_NAME}="2"]`,
				],
				unexpectedQueries: [`//default:Root[@${CUSTOM_RECORD_ID_ATTRIBUTE}]`],
			},
			'children ordering': {
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2">
							<AA_1 aAA_1="value aa1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3"/>
							<AA_2 aAA_2="value aa2" ${CUSTOM_RECORD_ID_ATTRIBUTE}="4"/>
						</A>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:A/default:AA_1[@aAA_1="value aa1"]',
					'//default:A/default:AA_2[@aAA_2="value aa2"]',
					'//default:A/*[1][self::default:AA_1]',
					'//default:A/*[2][self::default:AA_2]',
				],
			},
			'same attribute with two different namespaces': {
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ext:cA="value cA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
					</Root>
				`,
				expectedQueries: [
					'//default:Root[@root="1"]',
					'//default:Root[@ext:root="2"]',
					'//default:Root/default:A[@aA="value aA"]',
					'//default:Root/default:A[@ext:cA="value cA"]',
				],
			},
			'namespace element': {
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<ext:AA_3 aAA_3="value aAA_3" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
					</Root>
				`,
				expectedQueries: [
					'//default:Root[@root="1"]',
					'//default:Root[@ext:root="2"]',
					'//default:Root/ext:AA_3[@aAA_3="value aAA_3"]',
				],
			},
			'root element with both unqualified and qualified version attributes': {
				sourceXml: /* xml */ `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<ext:AA_3 aAA_3="value" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"/>
					</Root>
				`,
				expectedQueries: [
					'//default:Root[@root="1"]',
					'//default:Root[@ext:root="2"]',
					'//default:Root/ext:AA_3[@aAA_3="value"]',
				],
			},
		}

		runTestCases.withExport({
			testCases,
			act: async ({ source }): Promise<ActResult> => {
				return { assertDatabaseName: source.databaseName }
			},
		})

		type CorruptionTestCase = BaseTestCase & {
			data: AnyRawRecord[]
			expectedError: string
		}

		const corruptionTestCases: Record<string, CorruptionTestCase> = {
			'parent references single non-existent child': {
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
			'parent references multiple non-existent children': {
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
		}

		runTestCases.generic(corruptionTestCases, async (tc: CorruptionTestCase) => {
			const databaseName = `corruption-${crypto.randomUUID()}`
			await writeToDatabase(databaseName, tc.data)

			await expect(
				exportXmlFile({ databaseName, extension: '.xml', dialecteConfig: TEST_DIALECTE_CONFIG }),
			).rejects.toThrowError(tc.expectedError)

			databaseNames.push(databaseName)
		})
	})

	describe('Empty-attribute stripping', () => {
		type StrippingTestCase = BaseTestCase & {
			data: AnyRawRecord[]
			expectedContains: string[]
			expectedNotContains: string[]
		}

		const testCases: Record<string, StrippingTestCase> = {
			'identity-field attribute matching empty default -> preserved': {
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
						attributes: [{ name: 'aA', value: 'val' }],
						parent: { id: '1', tagName: 'Root' },
						children: [{ id: '3', tagName: 'B' }],
					},
					{
						id: '3',
						tagName: 'B',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'aB', value: 'val' }],
						parent: { id: '2', tagName: 'A' },
						children: [{ id: '4', tagName: 'BB_1' }],
					},
					{
						id: '4',
						tagName: 'BB_1',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [
							{ name: 'aBB_1', value: 'req' },
							{ name: 'dBB_1', value: '' },
							{ name: 'eBB_1', value: '' },
						],
						parent: { id: '3', tagName: 'B' },
						children: [{ id: '5', tagName: 'BBB_1' }],
					},
					{
						id: '5',
						tagName: 'BBB_1',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'aBBB_1', value: 'x' }],
						parent: { id: '4', tagName: 'BB_1' },
						children: [],
					},
				],
				expectedContains: ['dBB_1=""', 'aBB_1="req"'],
				expectedNotContains: ['eBB_1'],
			},
			'non-default value on non-identity attribute -> preserved': {
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
						attributes: [{ name: 'aA', value: 'val' }],
						parent: { id: '1', tagName: 'Root' },
						children: [{ id: '3', tagName: 'B' }],
					},
					{
						id: '3',
						tagName: 'B',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'aB', value: 'val' }],
						parent: { id: '2', tagName: 'A' },
						children: [{ id: '4', tagName: 'BB_1' }],
					},
					{
						id: '4',
						tagName: 'BB_1',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [
							{ name: 'aBB_1', value: 'req' },
							{ name: 'eBB_1', value: 'custom' },
						],
						parent: { id: '3', tagName: 'B' },
						children: [{ id: '5', tagName: 'BBB_1' }],
					},
					{
						id: '5',
						tagName: 'BBB_1',
						namespace: DIALECTE_NAMESPACES.default,
						value: '',
						attributes: [{ name: 'aBBB_1', value: 'x' }],
						parent: { id: '4', tagName: 'BB_1' },
						children: [],
					},
				],
				expectedContains: ['eBB_1="custom"'],
				expectedNotContains: [],
			},
		}

		runTestCases.generic(testCases, async (tc: StrippingTestCase) => {
			const databaseName = `stripping-${crypto.randomUUID()}`
			await writeToDatabase(databaseName, tc.data)

			const exported = await exportXmlFile({
				databaseName,
				extension: '.xml',
				dialecteConfig: TEST_DIALECTE_CONFIG,
			})
			const xmlString = new XMLSerializer().serializeToString(exported.xmlDocument)

			for (const expected of tc.expectedContains) {
				expect(xmlString).toContain(expected)
			}
			for (const notExpected of tc.expectedNotContains) {
				expect(xmlString).not.toContain(notExpected)
			}

			databaseNames.push(databaseName)
		})
	})

	describe('Malformed data resilience', () => {
		type MalformedTestCase = BaseTestCase & {
			data: AnyRawRecord[]
			expectedContains: string[]
			expectedNotContains: string[]
		}

		const testCases: Record<string, MalformedTestCase> = {
			'element with xmlns prefix in namespace object': {
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
			'xmlns attribute stored by extension': {
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
			'qualified xmlns attribute stored by extension': {
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
			'empty prefix in non-default namespace': {
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
		}

		runTestCases.generic(testCases, async (tc: MalformedTestCase) => {
			const databaseName = `malformed-${crypto.randomUUID()}`
			await writeToDatabase(databaseName, tc.data)

			const exported = await exportXmlFile({
				databaseName,
				extension: '.xml',
				dialecteConfig: TEST_DIALECTE_CONFIG,
			})
			const xmlString = new XMLSerializer().serializeToString(exported.xmlDocument)

			for (const expected of tc.expectedContains) {
				expect(xmlString).toContain(expected)
			}
			for (const notExpected of tc.expectedNotContains) {
				expect(xmlString).not.toContain(notExpected)
			}

			databaseNames.push(databaseName)
		})
	})
})

async function writeToDatabase(databaseName: string, records: AnyRawRecord[]) {
	const { createDatabaseInstance } = await import('../database')
	const databaseInstance = createDatabaseInstance({
		databaseName,
		dialecteConfig: TEST_DIALECTE_CONFIG,
	})

	const currentTable = databaseInstance.table(TEST_DIALECTE_CONFIG.database.tables.xmlElements.name)
	await databaseInstance.transaction('rw', currentTable, async () => {
		return currentTable.bulkAdd(records)
	})
	databaseInstance.close()
}
