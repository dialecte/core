import { createXmlAssertions } from './assert-xml'
import { DIALECTE_TEST_NAMESPACES, XMLNS_DEFAULT_NAMESPACE } from './constant'
import { runTestCases } from './run-test-cases'
import { countXmlParses } from './xml'

import { afterEach, describe, expect, it } from 'vitest'

import type { ActResult } from './run-test-cases.type'

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_TEST_NAMESPACES,
})

const SAMPLE_XML = `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/><B aB="2"/></Root>`

describe('one parse per target', () => {
	it('one assertion call with three expected queries → the text is parsed once', () => {
		let parsesBefore = 0
		expect((parsesBefore = countXmlParses())).toBeTypeOf('number')
		assertExpectedElementQueries({
			xml: SAMPLE_XML,
			queries: ['//default:A', '//default:B[@aB="2"]', '//default:Root'],
		})
		expect(countXmlParses() - parsesBefore).toBe(1)
	})

	it('one assertion call with three unexpected queries → the text is parsed once', () => {
		let parsesBefore = 0
		expect((parsesBefore = countXmlParses())).toBeTypeOf('number')
		assertUnexpectedElementQueries({
			xml: SAMPLE_XML,
			queries: ['//default:C', '//default:D', '//default:E'],
		})
		expect(countXmlParses() - parsesBefore).toBe(1)
	})

	describe('the runner', () => {
		let parsesBefore = 0

		afterEach(() => {
			expect(countXmlParses() - parsesBefore).toBe(1)
		})

		runTestCases.withExport({
			testCases: {
				'a case with expected and unexpected queries → the output is parsed once, for both': {
					sourceXml: `<Root ${XMLNS_DEFAULT_NAMESPACE}><A aA="1"/></Root>`,
					expectedQueries: ['//default:A[@aA="1"]'],
					unexpectedQueries: ['//default:B'],
				},
			},
			act: async (): Promise<ActResult> => {
				expect((parsesBefore = countXmlParses())).toBeTypeOf('number')
				return {}
			},
		})
	})
})
