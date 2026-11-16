import packageText from '../../../package.json?raw'
import { KNOWN_EXCEPTION_REASONS } from './conformance.constants'
import knownExceptionsText from './known-exceptions.json?raw'
import { libxml2AdmitsValue } from './libxml2-admits-value'

import { describe, expect, it } from 'vitest'

import { runTestCases } from '@/test'
import { validateValue } from '@/validation'

import type { KnownException, KnownExceptionsFile } from './conformance.types'
import type { BaseTestCase } from '@/test'

const knownExceptions = JSON.parse(knownExceptionsText) as KnownExceptionsFile

type TestCase = BaseTestCase & { row: KnownException }

describe('known-exceptions.json', () => {
	it('records the libxml2-wasm version the rows were probed on, the one the package pins', () => {
		const pinned = (JSON.parse(packageText) as { dependencies: Record<string, string> })
			.dependencies['libxml2-wasm']
		expect(knownExceptions.libxml2Wasm).toBe(pinned)
	})

	// each row: core's verdict is the recorded one, libxml2-wasm gives the OTHER verdict (else the row is unused)
	runTestCases.generic<TestCase>(
		Object.fromEntries(
			knownExceptions.rows.map((row) => [
				`row ${row.id} (${row.reason}): core ${row.core}, libxml2 the other verdict`,
				{ row },
			]),
		),
		({ row }) => {
			expect(KNOWN_EXCEPTION_REASONS).toContain(row.reason)
			expect(knownExceptions.rows.filter(({ id }) => id === row.id)).toHaveLength(1)
			const issue = validateValue({ value: row.value, type: row.type })
			expect(issue?.reason ?? 'admitted').toBe(row.core)
			expect(libxml2AdmitsValue({ xsd: row.xsd, value: row.value })).toBe(row.core !== 'admitted')
		},
	)
})
