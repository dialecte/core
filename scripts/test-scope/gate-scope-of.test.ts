import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { gateScopeOf } from './gate-scope-of'

import { afterEach, describe, expect, it } from 'vitest'

describe('gateScopeOf', () => {
	let folder: string | undefined

	afterEach(() => {
		if (folder) rmSync(folder, { recursive: true, force: true })
		folder = undefined
	})

	/** A changed-paths file as the gate writes it: each path followed by a NUL byte. */
	function changedFile(params: { paths: string[] }): string {
		folder = mkdtempSync(join(tmpdir(), 'test-scope-gate-'))
		const file = join(folder, 'changed')
		writeFileSync(file, params.paths.map((path) => `${path}\0`).join(''))
		return file
	}

	it("the gate's base, tree, changed paths and selection file", () => {
		const changed = changedFile({ paths: ['doc/a.md', 'src/errors/errors.ts'] })
		expect(
			gateScopeOf({
				env: {
					DIALECTE_GATE_BASE: 'b'.repeat(40),
					DIALECTE_GATE_TREE: 't'.repeat(40),
					DIALECTE_GATE_CHANGED: changed,
					DIALECTE_GATE_SELECTION: '/somewhere/selection-1.json',
				},
			}),
		).toEqual({
			base: 'b'.repeat(40),
			tree: 't'.repeat(40),
			changed: ['doc/a.md', 'src/errors/errors.ts'],
			selectionPath: '/somewhere/selection-1.json',
		})
	})

	it('nothing changed: an empty list', () => {
		const changed = changedFile({ paths: [] })
		expect(
			gateScopeOf({
				env: {
					DIALECTE_GATE_BASE: 'b',
					DIALECTE_GATE_TREE: 't',
					DIALECTE_GATE_CHANGED: changed,
					DIALECTE_GATE_SELECTION: '/s.json',
				},
			})?.changed,
		).toEqual([])
	})

	it('outside a gate (no changed-paths file named): none', () => {
		expect(gateScopeOf({ env: { DIALECTE_GATE_BASE: 'b' } })).toBeUndefined()
	})

	it('a changed-paths file named without the rest of the scope: refused, naming what is missing', () => {
		const changed = changedFile({ paths: ['a'] })
		expect(() =>
			gateScopeOf({ env: { DIALECTE_GATE_CHANGED: changed, DIALECTE_GATE_BASE: 'b' } }),
		).toThrow(/DIALECTE_GATE_TREE.*DIALECTE_GATE_SELECTION/)
	})
})
