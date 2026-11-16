import { actIssue } from './validate-query.fixtures'
import { SOURCE_XML } from './validate-query.fixtures.constants'

import { describe } from 'vitest'

import { runTestCases } from '@/test'

import type { IssueCase } from './validate-query.fixtures.types'

describe('query.validate.value - text', () => {
	runTestCases.withoutExport<IssueCase>({
		testCases: {
			'typed text, empty where a non-blank is required → pattern': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'BBB_1', id: 'bbb1' },
						tagName: 'BBBB_1',
						value: '',
					}),
				expected: {
					reason: 'pattern',
					actual: '',
					expected: ['[^\\t\\n\\r ]+'],
					facet: 'pattern',
				},
			},
			'typed text, a token → admitted': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({
						parent: { tagName: 'CCC_1', id: 'ccc1' },
						tagName: 'CCCC_1',
						value: '  a   token ',
					}),
			},
			'an element without typed text → not judged': {
				sourceXml: SOURCE_XML,
				check: (document) =>
					document.query.validate.value({ parent: { tagName: 'Root' }, tagName: 'A', value: 'x' }),
			},
		},
		act: actIssue,
	})
})
