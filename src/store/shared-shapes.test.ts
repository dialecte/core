import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HUB_PROTOCOL_VERSION } from './engine/hub/hub.constants'
import { posixPathOf, recordedText, runsInCi, sharedShape } from './shared-shapes.fixtures'
import { SQLITE_STORAGE_VERSION } from './sqlite-storage.constants'

import { describe, expect, it, onTestFinished } from 'vitest'

import { TEST_ENTRY_COMPILE_TIMEOUT_MS } from '@/test/test-timing.constants'

import type { SharedShapeCase } from './shared-shapes.fixtures.types'

const PACKAGE_ROOT = posixPathOf({
	path: fileURLToPath(new URL('../..', import.meta.url)),
}).replace(/\/$/, '')

/**
 * The files this guard reads, never loaded: each an edge of it, so `vitest run --changed` runs it when one changes.
 * A shared type declared outside them fails the guard below.
 */
const WATCHED = import.meta.glob(['../**/*.types.ts', '../**/types.ts', '../types/*.ts'])

/** What copies of the library share, each guarded by its version: a changed shape fails until the version is bumped. */
const SHARED_SHAPES: SharedShapeCase[] = [
	{
		// a copy's Project calls another copy's store, built from the registration
		versionName: 'SQLITE_STORAGE_VERSION',
		version: SQLITE_STORAGE_VERSION,
		recorded: 'sqlite-storage',
		roots: [{ file: 'src/store/sqlite-storage.types.ts', names: ['SqliteStorage', 'Store'] }],
	},
	{
		// the realm's connection, kept on its global object for every copy, and the messages between realm and hub
		versionName: 'HUB_PROTOCOL_VERSION',
		version: HUB_PROTOCOL_VERSION,
		recorded: 'hub-protocol',
		roots: [
			{ file: 'src/store/engine/hub/hub-client.types.ts', names: ['HubRegistry'] },
			{
				file: 'src/store/engine/hub/hub-protocol.types.ts',
				names: ['HubToRealmMessage', 'RealmToHubMessage'],
			},
		],
	},
]

function recordedFileOf(params: { shared: SharedShapeCase }): string {
	const { recorded, version } = params.shared
	return fileURLToPath(new URL(`./__shapes__/${recorded}-v${version}.txt`, import.meta.url))
}

function watchedFiles(): string[] {
	return Object.keys(WATCHED).map(function fromPackageRoot(key) {
		const path = posixPathOf({ path: fileURLToPath(new URL(key, import.meta.url)) })
		return path.slice(PACKAGE_ROOT.length + 1)
	})
}

describe('what copies of the library share, guarded by its version', () => {
	for (const shared of SHARED_SHAPES) {
		const { versionName, version, recorded } = shared
		it(
			`${versionName}: its shape → the one recorded in __shapes__/${recorded}-v${version}.txt (a changed shape: bump ${versionName}; a recorded file is never rewritten)`,
			() => {
				const { text, declaredIn } = sharedShape({ packageRoot: PACKAGE_ROOT, roots: shared.roots })
				const recordedShape = recordedText({
					file: recordedFileOf({ shared }),
					text,
					ci: runsInCi({ value: process.env.CI }),
					missing: `No shape recorded for ${versionName} ${version}: run this test locally once and commit __shapes__/${recorded}-v${version}.txt.`,
				})
				const watched = watchedFiles()
				expect(
					declaredIn.filter(function unwatched(file) {
						return !watched.includes(file)
					}),
					'files declaring a shared type that WATCHED does not name',
				).toEqual([])
				expect(
					text,
					`The shape ${versionName} ${version} shares changed: bump ${versionName} (the new version's file is written at its first local run); never rewrite __shapes__/${recorded}-v${version}.txt.`,
				).toBe(recordedShape)
			},
			TEST_ENTRY_COMPILE_TIMEOUT_MS,
		)
	}
})

describe('the shape written', () => {
	it(
		'a union open to any string (a catalogue, `| (string & {})`) → its strings written `string`, its other members kept: a string added changes nothing; a closed one by its members',
		() => {
			const { text } = sharedShape({
				packageRoot: PACKAGE_ROOT,
				roots: [{ file: 'src/store/shared-shapes.fixtures.types.ts', names: ['OpenUnionCase'] }],
			})
			expect(text).toBe(
				[
					'OpenUnionCase {',
					'  closed: "FIRST" | "SECOND"',
					'  key: string',
					'  mixed: 0 | string | { kind: "object"; }',
					'  optional?: string | undefined',
					'}',
					'',
				].join('\n'),
			)
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('a recorded text', () => {
	function scratchFile(params: { content?: string }): string {
		const directory = mkdtempSync(join(tmpdir(), 'dialecte-recorded-'))
		onTestFinished(function removeScratch() {
			rmSync(directory, { recursive: true, force: true })
		})
		// in a folder of its own: an absent file's folder is made with it
		const file = join(directory, '__shapes__', 'shape-v1.txt')
		if (params.content !== undefined) {
			mkdirSync(dirname(file))
			writeFileSync(file, params.content)
		}
		return file
	}

	/** What `file` holds; `undefined` when absent. */
	function heldIn(params: { file: string }): string | undefined {
		return existsSync(params.file) ? readFileSync(params.file, 'utf8') : undefined
	}

	type RecordedCase = {
		content?: string
		ci: boolean
		answered?: string
		refused?: string
		/** What the file holds after the call: `undefined`, still absent. */
		kept?: string
	}
	const recordedCases: Record<string, RecordedCase> = {
		'absent, run locally → written from the text, the text answered (a new version’s first run)': {
			ci: false,
			answered: 'new shape',
			kept: 'new shape',
		},
		'absent, run in CI → refused with the missing message, nothing written (it would be lost)': {
			ci: true,
			refused: 'nothing recorded',
		},
		'recorded, the same text → answered as recorded': {
			content: 'new shape',
			ci: false,
			answered: 'new shape',
			kept: 'new shape',
		},
		'recorded, another text → the recorded one answered, the file never rewritten': {
			content: 'old shape',
			ci: false,
			answered: 'old shape',
			kept: 'old shape',
		},
	}
	for (const [description, { content, ci, answered, refused, kept }] of Object.entries(
		recordedCases,
	)) {
		it(description, () => {
			const file = scratchFile({ content })
			const call = function record(): string {
				return recordedText({ file, text: 'new shape', ci, missing: 'nothing recorded' })
			}
			if (refused) expect(call).toThrow(refused)
			else expect(call()).toBe(answered)
			expect(heldIn({ file })).toBe(kept)
		})
	}
})

describe('the run, a CI’s', () => {
	const ciCases: Record<string, { value: string | undefined; ci: boolean }> = {
		'CI unset → not a CI': { value: undefined, ci: false },
		'CI empty → not a CI': { value: '', ci: false },
		'CI=false → not a CI': { value: 'false', ci: false },
		'CI=0 → not a CI': { value: '0', ci: false },
		'CI=true → a CI': { value: 'true', ci: true },
		'CI=1 → a CI': { value: '1', ci: true },
	}
	for (const [description, { value, ci }] of Object.entries(ciCases)) {
		it(description, () => {
			expect(runsInCi({ value })).toBe(ci)
		})
	}
})

describe('a path as the TypeScript compiler names files', () => {
	const pathCases: Record<string, { path: string; separator: string; posix: string }> = {
		'a Windows path → its parts joined by /': {
			path: 'C:\\work\\core\\src\\',
			separator: '\\',
			posix: 'C:/work/core/src/',
		},
		'a POSIX path → unchanged': {
			path: '/work/core/src/',
			separator: '/',
			posix: '/work/core/src/',
		},
	}
	for (const [description, { path, separator, posix }] of Object.entries(pathCases)) {
		it(description, () => {
			expect(posixPathOf({ path, separator })).toBe(posix)
		})
	}
})
