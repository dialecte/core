import { createDiagnostic, isKnownDiagnostic } from './diagnostics'

import { describe, expect, expectTypeOf, it } from 'vitest'

import { runTestCases } from '@/test'

import type { Diagnostic, DiagnosticCatalogue } from './types'
import type { BaseTestCase } from '@/test'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ALPHA = {
	source: 'alpha',
	codes: {
		'unresolved-reference': {
			severity: 'warning',
			family: 'reference',
			message: 'A reference names an element the file does not hold',
		},
		'incoherent-path-names': {
			severity: 'information',
			family: 'import',
			message: 'Names written from a path disagree with that path',
		},
	},
} as const satisfies DiagnosticCatalogue

// the same code under another source: a different diagnostic
const BETA = {
	source: 'beta',
	codes: {
		'unresolved-reference': {
			severity: 'error',
			family: 'reference',
			message: 'Beta: a reference names nothing',
		},
	},
} as const satisfies DiagnosticCatalogue

const REF = { tagName: 'A', id: 'a-1' }

// ── Tests ────────────────────────────────────────────────────────────────────

describe('isKnownDiagnostic', () => {
	type TestCase = BaseTestCase & {
		diagnostic: Diagnostic
		catalogues: readonly DiagnosticCatalogue[]
		expectedKnown: boolean
	}

	const testCases: Record<string, TestCase> = {
		'code and source of a named catalogue → known': {
			diagnostic: createDiagnostic(ALPHA, 'unresolved-reference', { ref: REF }),
			catalogues: [ALPHA],
			expectedKnown: true,
		},
		'code of a named catalogue, under another source → not known': {
			diagnostic: createDiagnostic(BETA, 'unresolved-reference', { ref: REF }),
			catalogues: [ALPHA],
			expectedKnown: false,
		},
		'code of no named catalogue → not known': {
			diagnostic: {
				...createDiagnostic(ALPHA, 'unresolved-reference', { ref: REF }),
				code: 'other',
			},
			catalogues: [ALPHA, BETA],
			expectedKnown: false,
		},
		'second of two catalogues holds it → known': {
			diagnostic: createDiagnostic(BETA, 'unresolved-reference', { ref: REF }),
			catalogues: [ALPHA, BETA],
			expectedKnown: true,
		},
		'no catalogue named → not known': {
			diagnostic: createDiagnostic(ALPHA, 'unresolved-reference', { ref: REF }),
			catalogues: [],
			expectedKnown: false,
		},
	}

	runTestCases.generic(testCases, (testCase) => {
		expect(isKnownDiagnostic(testCase.diagnostic, { catalogues: testCase.catalogues })).toBe(
			testCase.expectedKnown,
		)
	})

	it('narrows the code to the codes of the catalogues named', () => {
		const diagnostic: Diagnostic = createDiagnostic(ALPHA, 'unresolved-reference', { ref: REF })
		if (isKnownDiagnostic(diagnostic, { catalogues: [ALPHA, BETA] })) {
			expectTypeOf(diagnostic.code).toEqualTypeOf<
				'unresolved-reference' | 'incoherent-path-names'
			>()
		} else {
			expectTypeOf(diagnostic.code).toEqualTypeOf<string>()
		}
	})
})

describe('createDiagnostic', () => {
	it('a code of the catalogue → severity, source and default wording come from the entry, nothing else is set', () => {
		expect(
			createDiagnostic(ALPHA, 'incoherent-path-names', {
				ref: { ...REF, attribute: 'name' },
				meta: { attributes: [{ name: 'name', value: 'x', expected: 'y' }] },
			}),
		).toStrictEqual({
			code: 'incoherent-path-names',
			severity: 'information',
			source: 'alpha',
			message: 'Names written from a path disagree with that path',
			ref: { tagName: 'A', id: 'a-1', attribute: 'name' },
			meta: { attributes: [{ name: 'name', value: 'x', expected: 'y' }] },
		})
	})

	it('related records given → carried; the meta and related given keep their type', () => {
		const diagnostic = createDiagnostic(ALPHA, 'unresolved-reference', {
			ref: { ...REF, attribute: 'function' },
			related: [
				{ ref: { tagName: 'Function', id: 'fn-1' }, message: 'the element the path names' },
			],
			meta: { pathValue: 'S1/Fn1', triedKeys: ['S1/Fn1'] },
		})
		expect(diagnostic.related).toStrictEqual([
			{ ref: { tagName: 'Function', id: 'fn-1' }, message: 'the element the path names' },
		])
		expectTypeOf(diagnostic.code).toEqualTypeOf<'unresolved-reference'>()
		expectTypeOf(diagnostic.meta).toEqualTypeOf<{ pathValue: string; triedKeys: string[] }>()
		// assignable to a dialecte's typed diagnostic without a cast
		type Typed = Diagnostic<'unresolved-reference'> & {
			meta: { pathValue: string; triedKeys: string[] }
		}
		const typed: Typed = diagnostic
		expect(typed).toBe(diagnostic)
	})

	it('a wording given → it replaces the default', () => {
		const diagnostic = createDiagnostic(ALPHA, 'unresolved-reference', {
			ref: REF,
			message: 'FunctionRef "x" names no Function',
		})
		expect(diagnostic.message).toBe('FunctionRef "x" names no Function')
	})

	it('a code the catalogue does not hold → refused at the type level, throws ASSERTION_FAILED at runtime', () => {
		// @ts-expect-error 'unknown' is not a code of ALPHA
		expect(() => createDiagnostic(ALPHA, 'unknown', { ref: REF })).toThrow(
			expect.objectContaining({ cause: expect.objectContaining({ key: 'ASSERTION_FAILED' }) }),
		)
	})
})
