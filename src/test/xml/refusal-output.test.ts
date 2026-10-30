import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect } from 'vitest'

import { runTestCases } from '@/test'

import type { BaseTestCase } from '@/test'

// libxml2-wasm binds the console when its module loads, so a spy set in a test never sees what the engine
// writes: the output of a refusal is read from a child process, with the raw engine as the positive control.
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const TSX = join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsx')
const PROBE = join(PACKAGE_ROOT, 'src', 'test', 'xml', 'refusal-probe.script.ts')
const CHILD_TIMEOUT_MILLISECONDS = 60_000

function runProbe(params: { mode: 'seam' | 'control'; expression: string }) {
	const { mode, expression } = params
	const result = spawnSync(TSX, [PROBE, mode, expression], {
		cwd: PACKAGE_ROOT,
		encoding: 'utf8',
		timeout: CHILD_TIMEOUT_MILLISECONDS,
	})
	return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('a refused expression writes nothing', { timeout: 2 * CHILD_TIMEOUT_MILLISECONDS }, () => {
	type TestCase = BaseTestCase & { expression: string }

	const testCases: Record<string, TestCase> = {
		'an unbound prefix → refused through the seam, silent; the raw engine is not': {
			expression: '//unknown:A',
		},
		'a syntax error → refused through the seam, silent; the raw engine is not': {
			expression: '//default:A[',
		},
	}

	function act({ expression }: TestCase) {
		expect({
			seam: runProbe({ mode: 'seam', expression }),
			rawEngineWritesToStderr: runProbe({ mode: 'control', expression }).stderr.includes(
				'XPath error',
			),
		}).toEqual({
			seam: { status: 0, stdout: '', stderr: '' },
			rawEngineWritesToStderr: true,
		})
	}

	runTestCases.generic(testCases, act)
})
