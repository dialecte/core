import { describe } from 'vitest'

import { CUSTOM_RECORD_ID_ATTRIBUTE } from '@/helpers'
import { importXmlFiles } from '@/io/import'
import {
	XMLNS_EXT_NAMESPACE,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
	runTestCases,
} from '@/test'

import type { BaseXmlTestCase, ActResult } from '@/test'

describe('Import', () => {
	describe('Feature', () => {
		type TestCase = BaseXmlTestCase

		const testCases: Record<string, TestCase> = {
			'empty root': {
				sourceXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1"></Root>`,
				expectedQueries: ['//default:Root'],
			},
			'child with attribute': {
				sourceXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1"><A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"></A></Root>`,
				expectedQueries: ['//default:Root/default:A[@aA="value aA"]'],
			},
			'namespace element with text': {
				sourceXml: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"></A>
						<ext:AA_3 aAA_3="value aAA_3" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3">text value</ext:AA_3>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:Root/ext:AA_3[@aAA_3="value aAA_3"]',
					'//default:Root/ext:AA_3[text()="text value"]',
				],
			},
			'multiple siblings': {
				sourceXml: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"></A>
						<B aB="value aB" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3"></B>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:Root/default:B[@aB="value aB"]',
				],
			},
			'parent/child relationships': {
				sourceXml: `<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1"><A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"><AA_1 aAA_1="value aAA_1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3"/></A></Root>`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:Root/default:A/default:AA_1[@aAA_1="value aAA_1"]',
				],
			},
			'qualified attributes with local name': {
				sourceXml: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${XMLNS_EXT_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ext:cA="value cA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2"></A>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:Root/default:A[@ext:cA="value cA"]',
				],
			},
			'deep nesting': {
				sourceXml: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2">
							<AA_1 aAA_1="value aAA_1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3">
								<AAA_1 aAAA_1="value aAAA_1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="4">
									<AAAA_1 aAAAA_1="value aAAAA_1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="5"/>
								</AAA_1>
							</AA_1>
						</A>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:A/default:AA_1[@aAA_1="value aAA_1"]',
					'//default:AA_1/default:AAA_1[@aAAA_1="value aAAA_1"]',
					'//default:AAA_1/default:AAAA_1[@aAAAA_1="value aAAAA_1"]',
				],
			},
		}

		runTestCases.withExport({
			testCases,
			act: async ({ source }): Promise<ActResult> => {
				return { assertDatabaseName: source.databaseName }
			},
		})
	})

	describe('Overwrite', () => {
		type TestCase = BaseXmlTestCase

		const testCases: Record<string, TestCase> = {
			'reimporting same XML overwrites without duplication': {
				sourceXml: `
					<Root ${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE} ${CUSTOM_RECORD_ID_ATTRIBUTE}="1">
						<A aA="value aA" ${CUSTOM_RECORD_ID_ATTRIBUTE}="2">
							<AA_1 aAA_1="value aAA_1" ${CUSTOM_RECORD_ID_ATTRIBUTE}="3"/>
						</A>
					</Root>
				`,
				expectedQueries: [
					'//default:Root/default:A[@aA="value aA"]',
					'//default:A/default:AA_1[@aAA_1="value aAA_1"]',
				],
				unexpectedQueries: ['//default:Root/default:A[2]'],
			},
		}

		runTestCases.withExport({
			testCases,
			act: async ({ source, testCase }): Promise<ActResult> => {
				const file = new File([testCase.sourceXml], `${source.databaseName}.xml`, {
					type: 'text/xml',
				})
				await importXmlFiles({
					files: [file],
					dialecteConfig: TEST_DIALECTE_CONFIG,
					useCustomRecordsIds: true,
				})
				return { assertDatabaseName: source.databaseName }
			},
		})
	})
})
