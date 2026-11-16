import attributePatternDocument from './cases/attribute-pattern.xml?raw'
import validDocument from './cases/valid.xml?raw'
import twoDefectsDocument from './harness-fixtures/two-defects.xml?raw'
import { judgeWithLibxml2 } from './judge-with-libxml2'
import { runOracleCase } from './run-oracle-case'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { OracleCase } from './conformance.types'
import type { BaseTestCase } from '@/test'

type AcceptedCase = BaseTestCase & { oracleCase: OracleCase }

type RefusedCase = AcceptedCase & {
	/** What the refusal's message carries (each text on its own). */
	refusal: string[]
}

describe('runOracleCase - what it accepts', () => {
	runTestCases.generic<AcceptedCase>(
		{
			'a valid document expected valid → passes': {
				oracleCase: { name: 'harness valid', document: validDocument, expected: 'valid' },
			},
			'a defect libxml2 and the engine both flag, with the right code and attribute → passes': {
				oracleCase: {
					name: 'harness pattern',
					document: attributePatternDocument,
					expected: [{ at: 'a1', code: 'pattern', attribute: 'aA' }],
				},
			},
		},
		async ({ oracleCase }) => {
			await expect(runOracleCase({ oracleCase })).resolves.toBeUndefined()
		},
	)
})

describe('runOracleCase - what it refuses', () => {
	runTestCases.generic<RefusedCase>(
		{
			"a 'valid' case whose document libxml2 refuses → fails by the case's name": {
				oracleCase: {
					name: 'harness base is bad',
					document: attributePatternDocument,
					expected: 'valid',
				},
				refusal: ['harness base is bad', 'its base is refused'],
			},
			'a case expecting a record libxml2 does not flag → fails naming the record': {
				oracleCase: {
					name: 'harness wrong record',
					document: attributePatternDocument,
					expected: [
						{ at: 'a1', code: 'pattern', attribute: 'aA' },
						{ at: 'aa1', code: 'pattern', attribute: 'aAA_1' },
					],
				},
				refusal: ['harness wrong record', 'aa1'],
			},
			'a case that leaves out a record libxml2 flags → fails naming the record': {
				oracleCase: {
					name: 'harness missing record',
					document: twoDefectsDocument,
					expected: [{ at: 'a1', code: 'pattern', attribute: 'aA' }],
				},
				refusal: ['harness missing record', 'aa2'],
			},
			'a flagged record with another code than the case → fails naming both codes': {
				oracleCase: {
					name: 'harness wrong code',
					document: attributePatternDocument,
					expected: [{ at: 'a1', code: 'enumeration', attribute: 'aA' }],
				},
				refusal: ['harness wrong code', "'enumeration'", "'pattern'"],
			},
			'a flagged record with another attribute than the case → fails naming both attributes': {
				oracleCase: {
					name: 'harness wrong attribute',
					document: attributePatternDocument,
					expected: [{ at: 'a1', code: 'pattern', attribute: 'bA' }],
				},
				refusal: ['harness wrong attribute', "'bA'", "'aA'"],
			},
			'an attribute defect expected without its attribute → fails naming the attribute': {
				oracleCase: {
					name: 'harness no attribute',
					document: attributePatternDocument,
					expected: [{ at: 'a1', code: 'pattern' }],
				},
				refusal: ['harness no attribute', "'aA'"],
			},
		},
		async ({ oracleCase, refusal }) => {
			for (const text of refusal) {
				await expect(runOracleCase({ oracleCase })).rejects.toThrow(text)
			}
			// libxml2's wording is printed, never parsed
			const message = await runOracleCase({ oracleCase }).then(
				() => '',
				(error: Error) => error.message,
			)
			expect(
				judgeWithLibxml2({ document: oracleCase.document }).map((error) => error.message.trim()),
			).toSatisfy((wordings: string[]) => wordings.some((wording) => message.includes(wording)))
		},
	)
})
