import { importXmlFiles } from './main'
import { handleExpectedRecords } from './test.handler'

import Dexie from 'dexie'
import { describe, expect, it, afterAll } from 'vitest'

import {
	TEST_DIALECTE_CONFIG,
	DIALECTE_NAMESPACES,
	DEV_ID,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_EXT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/helpers'

import type { ExpectedRecords } from './test.types'
import type { AnyDatabaseInstance } from '@/database'

describe('Import', () => {
	describe('Feature', () => {
		const databaseNames: string[] = []

		afterAll(async () => {
			for (const dbName of databaseNames) {
				await Dexie.delete(dbName)
			}
		})

		type TestCase = {
			description: string
			fileContent: string
			expectedFileName: string
			expectedRecords: ExpectedRecords
		}

		const testCases: TestCase[] = [
			{
				description: 'empty root',
				fileContent: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"></Root>`,
				expectedFileName: 'empty-root',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
					},
				],
			},
			{
				description: 'child with attribute',
				fileContent: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A aA="value aA" ${DEV_ID}="2"></A></Root>`,
				expectedFileName: 'single-child',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
					},
					{
						id: '2',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'value aA' }],
					},
				],
			},
			{
				description: 'namespace element with text',
				fileContent: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE}  ${DEV_ID}="1">
						<A aA="value aA" ${DEV_ID}="2"></A>
						<ext:AA_3 aAA_3="value aAA_3" ${DEV_ID}="3">text value</ext:AA_3>
					</Root>
				`,
				expectedFileName: 'namespace-with-text',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
					},
					{
						id: '2',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'value aA' }],
					},
					{
						id: '3',
						tagName: 'AA_3',
						namespace: DIALECTE_NAMESPACES.ext,
						attributes: [{ name: 'aAA_3', value: 'value aAA_3' }],
						value: 'text value',
					},
				],
			},
			{
				description: 'multiple siblings',
				fileContent: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A aA="value aA" ${DEV_ID}="2"></A>
						<B aB="value aB" ${DEV_ID}="3"></B>
					</Root>
				`,
				expectedFileName: 'multiple-siblings',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
					},
					{
						id: '2',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'value aA' }],
					},
					{
						id: '3',
						tagName: 'B',
						attributes: [{ name: 'aB', value: 'value aB' }],
					},
				],
			},
			{
				description: 'parent/child relationships',
				fileContent: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1"><A aA="value aA" ${DEV_ID}="2"><AA_1 aAA_1="value aAA_1" ${DEV_ID}="3"/></A></Root>`,
				expectedFileName: 'parent-relationships',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'value aA' }],
						parent: { id: '1', tagName: 'Root' },
						children: [{ id: '3', tagName: 'AA_1' }],
					},
					{
						id: '3',
						tagName: 'AA_1',
						attributes: [{ name: 'aAA_1', value: 'value aAA_1' }],
						parent: { id: '2', tagName: 'A' },
					},
				],
			},
			// TODO: Uncomment when issue #789 is resolved (filtering xmlns at import)
			// {
			// 	description: 'xmlns NOT imported as attributes',
			// 	fileName: 'xmlns-not-imported.xml',
			// 	fileContent: `
			// 		<Root xmlns="http://root.org/ROOT" xmlns:ext="http://example.com/ext" version="1.0" ${DEV_NAMESPACE} ${DEV_ID}="1">
			// 			<A name="TestA" ${DEV_ID}="2"></A>
			// 		</Root>
			// 	`,
			// 	expectedFileName: 'xmlns-not-imported',
			// 	expectedRecords: [
			// 		{
			// 			id: '1',
			// 			tagName: 'Root',
			// 			// xmlns and xmlns:ext should NOT be in attributes
			// 			// only version should be imported
			// 			attributes: [{ name: 'version', value: '1.0' }],
			// 			children: [{ id: '2', tagName: 'A' }],
			// 		},
			// 		{
			// 			id: '2',
			// 			tagName: 'A',
			// 			attributes: [{ name: 'name', value: 'TestA' }],
			// 			parent: { id: '1', tagName: 'Root' },
			// 		},
			// 	],
			// },
			{
				description: 'qualified attributes with local name',
				fileContent: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${DEV_ID}="1">
						<A aA="value aA" ext:cA="value cA" ${DEV_ID}="2"></A>
					</Root>
				`,
				expectedFileName: 'qualified-attributes',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
						children: [{ id: '2', tagName: 'A' }],
					},
					{
						id: '2',
						tagName: 'A',
						parent: { id: '1', tagName: 'Root' },
						attributes: [
							{ name: 'aA', value: 'value aA' },
							{
								name: 'cA',
								value: 'value cA',
								namespace: DIALECTE_NAMESPACES.ext,
							},
						],
					},
				],
			},
			{
				description: 'deep nesting',
				fileContent: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${DEV_ID}="1">
						<A aA="value aA" ${DEV_ID}="2">
							<AA_1 aAA_1="value aAA_1" ${DEV_ID}="3">
								<AAA_1 aAAA_1="value aAAA_1" ${DEV_ID}="4">
									<AAAA_1 aAAAA_1="value aAAAA_1" ${DEV_ID}="5"/>
								</AAA_1>
							</AA_1>
						</A>
					</Root>
				`,
				expectedFileName: 'deep-nesting',
				expectedRecords: [
					{
						id: '1',
						tagName: 'Root',
					},
					{
						id: '2',
						tagName: 'A',
						attributes: [{ name: 'aA', value: 'value aA' }],
					},
					{
						id: '3',
						tagName: 'AA_1',
						attributes: [{ name: 'aAA_1', value: 'value aAA_1' }],
					},
					{
						id: '4',
						tagName: 'AAA_1',
						attributes: [{ name: 'aAAA_1', value: 'value aAAA_1' }],
					},
					{
						id: '5',
						tagName: 'AAAA_1',
						attributes: [{ name: 'aAAAA_1', value: 'value aAAAA_1' }],
					},
				],
			},
		]

		testCases.forEach((testCase) => {
			testFeature(testCase)
			testFeature(testCase) // test overwrite feature
		})

		function testFeature({ description, fileContent, expectedRecords }: TestCase) {
			it(description, async () => {
				const filename = `${description.replace(/\s+/g, '-')}-${crypto.randomUUID()}.xml`
				const file = new File([fileContent], filename, {
					type: 'text/plain',
				})

				const databaseNames = await importXmlFiles({
					files: [file],
					dialecteConfig: TEST_DIALECTE_CONFIG,
					useCustomRecordsIds: true,
				})
				const databaseName = filename.replace(/\.xml$/, '')
				expect(databaseNames).toContain(databaseName)

				const databaseInstance = new Dexie(databaseName) as AnyDatabaseInstance
				await databaseInstance.open()
				await handleExpectedRecords({
					dialecteConfig: TEST_DIALECTE_CONFIG,
					databaseInstance,
					expectedRecords,
				})

				databaseInstance.close()
				databaseNames.push(databaseName)
			})
		}
	})
})
