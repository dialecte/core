import { DIALECTE_TEST_NAMESPACES } from '../constant'
import * as testEntry from '../index'
import { MalformedXmlError } from '../xml'
import { createXmlAssertions } from './assert-xml'

import { describe, expect, it } from 'vitest'

import { XmlAssertionError, runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

const DEFAULT_NS_URI = DIALECTE_TEST_NAMESPACES.default.uri
const EXT_NS_URI = DIALECTE_TEST_NAMESPACES.ext.uri
const EXT_PREFIX = DIALECTE_TEST_NAMESPACES.ext.prefix

const { assertExpectedElementQueries, assertUnexpectedElementQueries } = createXmlAssertions({
	namespaces: DIALECTE_TEST_NAMESPACES,
})

// ── Failure messages ─────────────────────────────────────────────────────────

const DIAGNOSTIC_XML = [
	`<Root xmlns="${DEFAULT_NS_URI}" xmlns:${EXT_PREFIX}="${EXT_NS_URI}" root="1">`,
	'  <A aA="a1">',
	'    <AA_1 aAA_1="v1"/>',
	'    <AA_1 aAA_1="v2" other="o"/>',
	'  </A>',
	'  <A aA="a2">',
	'    <AA_2 aAA_2="w"/>',
	`    <${EXT_PREFIX}:AA_3 ${EXT_PREFIX}:aAA_3="x"/>`,
	'  </A>',
	'</Root>',
].join('\n')

/** A message line: its label, then its value, whatever the padding between them. */
function messageLine(params: { label: string; value: string | RegExp }): RegExp {
	const { label, value } = params
	const source = typeof value === 'string' ? escapeRegExp(value) : value.source
	return new RegExp(`^ +${label} +${source}$`, 'm')
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function messageOf(run: () => void): string {
	try {
		run()
	} catch (error) {
		return (error as Error).message
	}
	return ''
}

describe('assertExpectedElementQueries failure message', () => {
	type TestCase = BaseTestCase & {
		xml: string
		query: string
		expectedLines: RegExp[]
	}

	const testCases: Record<string, TestCase> = {
		'step 2 of 2 fails, the last match has such children → header, query, matched, failed, at, nearby':
			{
				xml: DIAGNOSTIC_XML,
				query: '//default:A[@aA="a1"]/default:AA_1[@aAA_1="zz"]',
				expectedLines: [
					/^Expected element not found$/m,
					messageLine({ label: 'query', value: '//default:A[@aA="a1"]/default:AA_1[@aAA_1="zz"]' }),
					messageLine({ label: 'matched', value: /\/\/default:A\[@aA="a1"\] +step 1 of 2/ }),
					messageLine({ label: 'failed', value: '/default:AA_1[@aAA_1="zz"]' }),
					messageLine({ label: 'at', value: /\/Root\[1\]\/A\[1\] +line 2/ }),
					messageLine({
						label: 'nearby',
						value: 'AA_1 aAA_1="v1" (line 3), AA_1 aAA_1="v2" (line 4)',
					}),
					/^ +context$/m,
					/^ +<A aA="a1">$/m,
				],
			},
		'the last match is the second A → its positional path and line': {
			xml: DIAGNOSTIC_XML,
			query: '//default:A[@aA="a2"]/default:AA_2[@aAA_2="zz"]',
			expectedLines: [
				messageLine({ label: 'at', value: /\/Root\[1\]\/A\[2\] +line 6/ }),
				messageLine({ label: 'nearby', value: 'AA_2 aAA_2="w" (line 7)' }),
			],
		},
		'step 3 of 3 fails → matched names the first two steps, at is two levels down': {
			xml: DIAGNOSTIC_XML,
			query: '//default:A[@aA="a1"]//default:AA_1[@aAA_1="v2"]/default:Zed',
			expectedLines: [
				messageLine({
					label: 'matched',
					value: /\/\/default:A\[@aA="a1"\]\/\/default:AA_1\[@aAA_1="v2"\] +step 2 of 3/,
				}),
				messageLine({ label: 'failed', value: '/default:Zed' }),
				messageLine({ label: 'at', value: /\/Root\[1\]\/A\[1\]\/AA_1\[2\] +line 4/ }),
			],
		},
		'the failing step name is absent under the last match → none: <tag> has no <name> child': {
			xml: DIAGNOSTIC_XML,
			query: '//default:A[@aA="a2"]/default:AA_1[@aAA_1="v1"]',
			expectedLines: [messageLine({ label: 'nearby', value: 'none: A has no AA_1 child' })],
		},
		'the failing step name exists in another namespace → none, and the prefix to type and its URI are named':
			{
				xml: DIAGNOSTIC_XML,
				query: '//default:A[@aA="a2"]/default:AA_3[@ext:aAA_3="x"]',
				expectedLines: [
					messageLine({
						label: 'nearby',
						value: `none: A has no AA_3 child; ${EXT_PREFIX}:AA_3 exists (${EXT_PREFIX} = ${EXT_NS_URI})`,
					}),
				],
			},
		'the context holds a prefixed element → printed with its prefix': {
			xml: DIAGNOSTIC_XML,
			query: '//default:A[@aA="a2"]/default:Zed',
			expectedLines: [new RegExp(`^ +<${EXT_PREFIX}:AA_3 ${EXT_PREFIX}:aAA_3="x"/>$`, 'm')],
		},
		'nothing matched from the root → the message says so, the document is the context': {
			xml: DIAGNOSTIC_XML,
			query: '//default:C',
			expectedLines: [
				/^Expected element not found$/m,
				messageLine({ label: 'matched', value: /nothing +step 0 of 1/ }),
				messageLine({ label: 'failed', value: '//default:C' }),
				/^ +context$/m,
				/^ +<Root [^>]*root="1">$/m,
				/^ +<A aA="a1">$/m,
			],
		},
	}

	function act({ xml, query, expectedLines }: TestCase) {
		const message = messageOf(() => assertExpectedElementQueries({ xml, queries: [query] }))
		for (const expectedLine of expectedLines) {
			expect(message).toMatch(expectedLine)
		}
	}

	runTestCases.generic(testCases, act)

	it('a query that fails with attributes its predicates do not name → nearby shows only the named ones', () => {
		const message = messageOf(() =>
			assertExpectedElementQueries({
				xml: DIAGNOSTIC_XML,
				queries: ['//default:A[@aA="a1"]/default:AA_1[@aAA_1="zz"]'],
			}),
		)
		expect(message).toMatch(/nearby +AA_1/)
		expect(message).not.toMatch(/nearby.*other=/)
	})

	it('more than ten candidates → nearby lists ten', () => {
		const children = Array.from(
			{ length: 12 },
			(_, index) => `<AA_1 aAA_1="n${index + 1}" />`,
		).join('')
		const xml = `<Root xmlns="${DEFAULT_NS_URI}"><A aA="many">${children}</A></Root>`
		const message = messageOf(() =>
			assertExpectedElementQueries({
				xml,
				queries: ['//default:A[@aA="many"]/default:AA_1[@aAA_1="zz"]'],
			}),
		)
		const nearbyLine = message.split('\n').find((line) => /^ +nearby /.test(line)) ?? ''
		expect(nearbyLine.match(/AA_1 aAA_1=/g)?.length).toBe(10)
		expect(nearbyLine).toContain('aAA_1="n10"')
		expect(nearbyLine).not.toContain('aAA_1="n11"')
	})

	it('a context over 200 lines → cut at 200, saying how many lines were left out', () => {
		const children = Array.from({ length: 300 }, () => '<AA_2 aAA_2="x"/>').join('\n')
		const xml = `<Root xmlns="${DEFAULT_NS_URI}">\n<A aA="big">\n${children}\n</A>\n</Root>`
		const message = messageOf(() =>
			assertExpectedElementQueries({ xml, queries: ['//default:A[@aA="big"]/default:Zed'] }),
		)
		const lines = message.split('\n')
		const contextLines = lines.slice(lines.findIndex((line) => /^ +context$/.test(line)) + 1)
		expect(contextLines).toHaveLength(201)
		expect(contextLines[200]).toMatch(/^ +… \(102 more lines\)$/)
	})
})

describe('failure message, the fixes of the implementation review', () => {
	const NS = `xmlns="${DEFAULT_NS_URI}"`

	function fillerLines(count: number): string {
		return Array.from({ length: count }, () => '<AA_2 aAA_2="x"/>').join('\n')
	}

	describe('lines', () => {
		type TestCase = BaseTestCase & { fillers: number; expectedLine: string }

		const testCases: Record<string, TestCase> = {
			'an element on line 70002 → the line is given as a lower bound': {
				fillers: 70_000,
				expectedLine: 'line ≥ 65535',
			},
			'an element on line 65000 → its exact line': {
				fillers: 64_998,
				expectedLine: 'line 65000',
			},
		}

		function act({ fillers, expectedLine }: TestCase) {
			const xml = `<Root ${NS}>\n${fillerLines(fillers)}\n<A aA="late"><AA_1 aAA_1="1"/></A>\n</Root>`
			const message = messageOf(() =>
				assertExpectedElementQueries({ xml, queries: ['//default:A[@aA="late"]/default:Zed'] }),
			)
			expect(message).toMatch(
				messageLine({
					label: 'at',
					value: new RegExp(`/Root\\[1\\]/A\\[1\\] +${escapeRegExp(expectedLine)}`),
				}),
			)
			expect(message).not.toMatch(/line 65535$/m)
		}

		runTestCases.generic(testCases, act)
	})

	describe('unions', () => {
		const UNION = '//default:Z | //default:Y'

		it('an expected union that selects nothing → the whole query, no broken step', () => {
			const message = messageOf(() =>
				assertExpectedElementQueries({ xml: DIAGNOSTIC_XML, queries: [UNION] }),
			)
			expect(message).toMatch(messageLine({ label: 'query', value: UNION }))
			expect(message).toMatch(messageLine({ label: 'matched', value: /nothing +step 0 of 1/ }))
			expect(message).toMatch(messageLine({ label: 'failed', value: UNION }))
		})

		it('an unexpected union whose branches are both absent → passes', () => {
			expect(() =>
				assertUnexpectedElementQueries({ xml: DIAGNOSTIC_XML, queries: [UNION] }),
			).not.toThrow()
		})

		it('an unexpected union where one branch is present → the element found, not an unreliable assertion', () => {
			const message = messageOf(() =>
				assertUnexpectedElementQueries({
					xml: DIAGNOSTIC_XML,
					queries: ['//default:A[@aA="a1"] | //default:Z'],
				}),
			)
			expect(message).toMatch(/^Unexpected element found$/m)
			expect(message).not.toMatch(/unreliable/i)
		})
	})

	describe('nearby covers every match of the prefix', () => {
		const TWO_PARENTS = [
			`<Root ${NS}>`,
			'  <A aA="a1">',
			'    <AA_1 aAA_1="1"/>',
			'  </A>',
			'  <A aA="a2">',
			'    <AA_1 aAA_1="2"/>',
			'  </A>',
			'</Root>',
		].join('\n')

		it('candidates under the first and the second match → both listed', () => {
			const message = messageOf(() =>
				assertExpectedElementQueries({
					xml: TWO_PARENTS,
					queries: ['//default:A/default:AA_1[@aAA_1="3"]'],
				}),
			)
			expect(message).toMatch(
				messageLine({ label: 'nearby', value: 'AA_1 aAA_1="1" (line 3), AA_1 aAA_1="2" (line 6)' }),
			)
		})

		it('more than ten candidates across the matches → ten listed, then how many more', () => {
			function children(count: number, offset: number): string {
				return Array.from(
					{ length: count },
					(_, index) => `<AA_1 aAA_1="n${offset + index}"/>`,
				).join('')
			}
			const xml = `<Root ${NS}><A aA="a1">${children(6, 1)}</A><A aA="a2">${children(6, 7)}</A></Root>`
			const message = messageOf(() =>
				assertExpectedElementQueries({ xml, queries: ['//default:A/default:AA_1[@aAA_1="zz"]'] }),
			)
			const nearbyLine = message.split('\n').find((line) => /^ +nearby /.test(line)) ?? ''
			expect(nearbyLine.match(/AA_1 aAA_1=/g)?.length).toBe(10)
			expect(nearbyLine).toContain('aAA_1="n7"')
			expect(nearbyLine).toMatch(/… \(2 more\)$/)
		})
	})

	describe('an unexpected node that is not an element', () => {
		const WITH_TEXT = `<Root ${NS}>\n<A aA="t">hello<!--note--></A>\n</Root>`

		const nodeCases: Record<string, { query: string; step: RegExp }> = {
			'a text node → its path ends in text()': {
				query: '//default:A[@aA="t"]/text()',
				step: /\/Root\[1\]\/A\[1\]\/text\(\)(\[1\])? +line 2/,
			},
			'a comment → its path ends in comment()': {
				query: '//default:A[@aA="t"]/comment()',
				step: /\/Root\[1\]\/A\[1\]\/comment\(\)(\[1\])? +line 2/,
			},
		}

		for (const [description, { query, step }] of Object.entries(nodeCases)) {
			it(description, () => {
				const message = messageOf(() =>
					assertUnexpectedElementQueries({ xml: WITH_TEXT, queries: [query] }),
				)
				expect(message).toMatch(messageLine({ label: 'at', value: step }))
				expect(message).not.toContain('node()')
			})
		}
	})
})

describe('assertUnexpectedElementQueries failure message', () => {
	it('the element exists → header, positional path, line, the element printed', () => {
		const message = messageOf(() =>
			assertUnexpectedElementQueries({
				xml: DIAGNOSTIC_XML,
				queries: ['//default:A[@aA="a1"]'],
			}),
		)
		expect(message).toMatch(/^Unexpected element found$/m)
		expect(message).toMatch(messageLine({ label: 'query', value: '//default:A[@aA="a1"]' }))
		expect(message).toMatch(messageLine({ label: 'at', value: /\/Root\[1\]\/A\[1\] +line 2/ }))
		expect(message).toMatch(/^ +<A aA="a1">$/m)
		expect(message).toMatch(/^ +<AA_1 aAA_1="v1"\/>$/m)
	})

	it('a deeper element exists → its own positional path and line', () => {
		const message = messageOf(() =>
			assertUnexpectedElementQueries({
				xml: DIAGNOSTIC_XML,
				queries: ['//default:A[@aA="a1"]/default:AA_1[@aAA_1="v2"]'],
			}),
		)
		expect(message).toMatch(
			messageLine({ label: 'at', value: /\/Root\[1\]\/A\[1\]\/AA_1\[2\] +line 4/ }),
		)
		expect(message).toMatch(/^ +<AA_1 aAA_1="v2" other="o"\/>$/m)
	})

	it('an ancestor step is missing → the assertion is called unreliable, naming the missing step', () => {
		const message = messageOf(() =>
			assertUnexpectedElementQueries({
				xml: DIAGNOSTIC_XML,
				queries: ['//default:A[@aA="NOPE"]//default:AA_1[@aAA_1="v1"]'],
			}),
		)
		expect(message).toMatch(/unreliable/i)
		expect(message).toMatch(messageLine({ label: 'failed', value: '//default:A[@aA="NOPE"]' }))
		expect(message).toMatch(/step 1 of 2/)
	})
})

describe('refused queries', () => {
	type TestCase = BaseTestCase & { query: string; reason: RegExp }

	const testCases: Record<string, TestCase> = {
		'a syntax error → refused, with the expression and a reason that is not the expression': {
			query: '//default:A[@aA=',
			reason: /^ +reason +(?!\/\/)\S/m,
		},
		'a prefix bound to no namespace → refused, naming the prefix': {
			query: '//unknown:A',
			reason: /^ +reason +.*Undefined namespace prefix: unknown/m,
		},
		'a prefix bound to no namespace after a step that matches nothing → refused, not reported as not found':
			{
				query: '//default:Missing/unknown:A',
				reason: /^ +reason +.*Undefined namespace prefix: unknown/m,
			},
	}

	const refusedXml = `<Root xmlns="${DEFAULT_NS_URI}"><A aA="x"/></Root>`

	function assertRefused(params: { message: string; query: string; reason: RegExp }) {
		const { message, query, reason } = params
		expect(message).toMatch(/^Query refused$/m)
		expect(message).toMatch(messageLine({ label: 'query', value: query }))
		expect(message).toMatch(reason)
	}

	for (const [description, { query, reason }] of Object.entries(testCases)) {
		it(`expected, ${description}`, () => {
			const message = messageOf(() =>
				assertExpectedElementQueries({ xml: refusedXml, queries: [query] }),
			)
			assertRefused({ message, query, reason })
		})

		it(`unexpected, ${description}`, () => {
			const message = messageOf(() =>
				assertUnexpectedElementQueries({ xml: refusedXml, queries: [query] }),
			)
			assertRefused({ message, query, reason })
		})
	}
})

describe('malformed XML text', () => {
	const malformedTexts: Record<string, string> = {
		'a tag closed by another name': '<Root><A></Root>',
		'a bare &': `<Root xmlns="${DEFAULT_NS_URI}"><A aA="a & b" /></Root>`,
		'a prefix bound to no namespace': `<Root xmlns="${DEFAULT_NS_URI}" xmlns:p=""><A aA="x" /></Root>`,
	}

	for (const [description, xml] of Object.entries(malformedTexts)) {
		it(`${description} → refused, in the seam's format under the label "queried XML"`, () => {
			const expectedMessage = /^queried XML: malformed XML - \d+:\d+ \S/
			expect(
				messageOf(() => assertExpectedElementQueries({ xml, queries: ['//default:A'] })),
			).toMatch(expectedMessage)
			expect(
				messageOf(() => assertUnexpectedElementQueries({ xml, queries: ['//default:A'] })),
			).toMatch(expectedMessage)
		})
	}
})

describe('the XML text is the only target', () => {
	it('the test entry → takes XML text only, and keeps the splitter and the seam internal', () => {
		const pageDocument = undefined as unknown as Document
		type Target = Parameters<typeof assertExpectedElementQueries>[0]
		// @ts-expect-error the `xmlDocument` target is gone: the assertions take XML text only
		const documentTarget: Target = { xmlDocument: pageDocument, queries: [] }
		void documentTarget
		const internal = [
			'splitXpathIntoSteps',
			'withXmlDocument',
			'selectNodes',
			'selectFirstNode',
			'printNode',
			'countOpenXmlDocuments',
			'countXmlParses',
		]
		expect(internal.filter((name) => name in testEntry)).toEqual([])
	})
})

describe('the error a failure throws', () => {
	const ANCESTOR_MISSING_QUERY = '//default:A[@aA="NOPE"]//default:AA_1[@aAA_1="v1"]'

	function thrownBy(run: () => void): unknown {
		try {
			run()
		} catch (error) {
			return error
		}
		throw new Error('expected the run to throw, it did not')
	}

	describe('a behaviour miss is an assertion', () => {
		it('an expected query selects nothing → an XmlAssertionError named AssertionError, header "Expected element not found"', () => {
			const error = thrownBy(() =>
				assertExpectedElementQueries({
					xml: DIAGNOSTIC_XML,
					queries: ['//default:A[@aA="a1"]/default:AA_1[@aAA_1="zz"]'],
				}),
			)
			expect(error).toBeInstanceOf(XmlAssertionError)
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).name).toBe('AssertionError')
			expect((error as Error).message).toMatch(/^Expected element not found$/m)
		})

		it('an unexpected query selects a node → an XmlAssertionError named AssertionError, header "Unexpected element found"', () => {
			const error = thrownBy(() =>
				assertUnexpectedElementQueries({
					xml: DIAGNOSTIC_XML,
					queries: ['//default:A[@aA="a1"]/default:AA_1[@aAA_1="v1"]'],
				}),
			)
			expect(error).toBeInstanceOf(XmlAssertionError)
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).name).toBe('AssertionError')
			expect((error as Error).message).toMatch(/^Unexpected element found$/m)
		})
	})

	describe('a test defect stays a plain error (kept as today)', () => {
		it('an unexpected query whose ancestor step matches nothing → a plain Error named Error, header "Unexpected element check unreliable"', () => {
			const error = thrownBy(() =>
				assertUnexpectedElementQueries({ xml: DIAGNOSTIC_XML, queries: [ANCESTOR_MISSING_QUERY] }),
			)
			expect(error).toBeInstanceOf(Error)
			expect(error).not.toBeInstanceOf(XmlAssertionError)
			expect((error as Error).name).toBe('Error')
			expect((error as Error).message).toMatch(/^Unexpected element check unreliable: /m)
		})

		it('an expected query the engine refuses (unterminated predicate) → a plain Error named Error, header "Query refused"', () => {
			const error = thrownBy(() =>
				assertExpectedElementQueries({ xml: DIAGNOSTIC_XML, queries: ['//default:A[@aA='] }),
			)
			expect(error).not.toBeInstanceOf(XmlAssertionError)
			expect((error as Error).name).toBe('Error')
			expect((error as Error).message).toMatch(/^Query refused$/m)
		})

		it('an unexpected query the engine refuses (unbound prefix) → a plain Error named Error, header "Query refused"', () => {
			const error = thrownBy(() =>
				assertUnexpectedElementQueries({ xml: DIAGNOSTIC_XML, queries: ['//unknown:A'] }),
			)
			expect(error).not.toBeInstanceOf(XmlAssertionError)
			expect((error as Error).name).toBe('Error')
			expect((error as Error).message).toMatch(/^Query refused$/m)
		})

		it('malformed queried XML → a MalformedXmlError, not an AssertionError', () => {
			const error = thrownBy(() =>
				assertExpectedElementQueries({ xml: '<Root><A></Root>', queries: ['//default:A'] }),
			)
			expect(error).toBeInstanceOf(MalformedXmlError)
			expect(error).not.toBeInstanceOf(XmlAssertionError)
			expect((error as Error).name).not.toBe('AssertionError')
		})
	})
})
