import { execFileSync } from 'node:child_process'
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HUB_PROTOCOL_VERSION } from './engine/hub/hub.constants'
import { ENGINE_WIRE_PROTOCOL } from './engine/wire/wire.constants'
import {
	committedInGit,
	posixPathOf,
	recordedText,
	runsInCi,
	sharedShape,
} from './shared-shapes.fixtures'
import { GIT_LS_FILES_TIMEOUT_MS } from './shared-shapes.fixtures.constants'
import { SQLITE_STORAGE_VERSION } from './sqlite-storage.constants'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { TEST_ENTRY_COMPILE_TIMEOUT_MS } from '@/test/test-timing.constants'

import type { SharedShapeCase } from './shared-shapes.fixtures.types'

const PACKAGE_ROOT = posixPathOf({
	path: fileURLToPath(new URL('../..', import.meta.url)),
}).replace(/\/$/, '')

/**
 * The files this guard reads, never loaded: each an edge of it, so `vitest run --changed` runs it when one changes.
 * A shared type declared outside them fails the guard below.
 */
const WATCHED = import.meta.glob([
	'../**/*.types.ts',
	'../**/types.ts',
	'../types/*.ts',
	// the values a shared type is computed from (`typeof`)
	'../**/*.constants.ts',
])

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
	{
		// a client calls an engine another copy of the library may have started: the calls, their answers, the wire
		// table, the control messages and the signals
		versionName: 'ENGINE_WIRE_PROTOCOL',
		version: ENGINE_WIRE_PROTOCOL,
		recorded: 'engine-wire',
		roots: [
			{
				file: 'src/store/engine/wire/wire.types.ts',
				names: ['EngineWire', 'WireAnswer', 'WireRequest'],
			},
			// its table, a value: its type as the guard declares it
			{ file: 'src/store/shared-shapes.fixtures.types.ts', names: ['EngineWireTable'] },
			{
				file: 'src/store/engine/engine.types.ts',
				names: ['EngineApi', 'EngineControlAnswer', 'EngineControlRequest', 'EngineLifeSignal'],
			},
			{
				file: 'src/store/engine/host/host.types.ts',
				names: ['EngineEventSignal', 'Heartbeat', 'ProgressSignal'],
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
				const file = recordedFileOf({ shared })
				const recordedShape = recordedText({
					file,
					text,
					committed: committedInGit,
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
					'  branded: "FIRST" | string & { readonly brand: "Id"; }',
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
		/** Whether git tracks the file (a version's recorded shape, committed). */
		committed?: boolean
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
		'absent but committed (deleted by hand), run locally → refused, nothing written: a recorded shape is restored, never rewritten':
			{ ci: false, committed: true, refused: 'is committed: restore it' },
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
	for (const [
		description,
		{ content, ci, committed = false, answered, refused, kept },
	] of Object.entries(recordedCases)) {
		it(description, () => {
			const file = scratchFile({ content })
			const askedGit = vi.fn(function trackedOrNot() {
				return committed
			})
			const call = function record(): string {
				return recordedText({
					file,
					text: 'new shape',
					ci,
					committed: askedGit,
					missing: 'nothing recorded',
				})
			}
			if (refused) expect(call).toThrow(refused)
			else expect(call()).toBe(answered)
			expect(heldIn({ file })).toBe(kept)
			// git asked only for a file that is absent
			expect(askedGit).toHaveBeenCalledTimes(content === undefined ? 1 : 0)
		})
	}
})

describe('a file committed in git', () => {
	/** A repository of the case (`tracked.txt` committed, `untracked.txt` not), removed after it. */
	function repositoryOfTheCase(): string {
		const directory = mkdtempSync(join(tmpdir(), 'dialecte-committed-'))
		onTestFinished(function removeRepository() {
			rmSync(directory, { recursive: true, force: true })
		})
		// git's own variables left out: inside a hook they name the commit's repository
		const environment = Object.fromEntries(
			Object.entries(process.env).filter(function notGits([name]) {
				return !name.startsWith('GIT_')
			}),
		)
		function git(args: string[]): void {
			execFileSync('git', args, {
				cwd: directory,
				env: environment,
				stdio: 'ignore',
				timeout: GIT_LS_FILES_TIMEOUT_MS,
			})
		}
		git(['init', '--quiet'])
		writeFileSync(join(directory, 'tracked.txt'), 'recorded')
		writeFileSync(join(directory, 'untracked.txt'), 'written')
		git(['add', 'tracked.txt'])
		return directory
	}

	type CommittedCase = {
		/** The file asked of: in the case's repository (`tracked.txt`, `untracked.txt`), else outside any. */
		file: (params: { repository: string }) => string
		git?: string
		committed?: boolean
		refused?: boolean
	}
	const committedCases: Record<string, CommittedCase> = {
		'a file git tracks → committed': {
			file: function tracked({ repository }) {
				return join(repository, 'tracked.txt')
			},
			committed: true,
		},
		'a file of the repository git does not track → not committed': {
			file: function untracked({ repository }) {
				return join(repository, 'untracked.txt')
			},
			committed: false,
		},
		'a file outside any repository → not committed': {
			file: function outside() {
				return join(tmpdir(), `dialecte-uncommitted-${crypto.randomUUID()}.txt`)
			},
			committed: false,
		},
		'git refusing the repository (its owner not the user: `safe.directory`) → thrown, not taken for "not a repository"':
			{
				file: function tracked({ repository }) {
					return join(repository, 'tracked.txt')
				},
				git: 'dubious-ownership',
				refused: true,
			},
		'no git to ask (or one that hangs) → thrown, not taken for "not committed": the guard fails, never writes':
			{
				file: function tracked({ repository }) {
					return join(repository, 'tracked.txt')
				},
				git: 'dialecte-no-such-git',
				refused: true,
			},
	}
	/** A git that refuses every repository as git does one of another owner: exit 128, its message. */
	function dubiousOwnershipGit(params: { directory: string }): string {
		const script = join(params.directory, 'dubious-git.sh')
		writeFileSync(
			script,
			`#!/bin/sh\necho "fatal: detected dubious ownership in repository at '$PWD'" >&2\nexit 128\n`,
		)
		chmodSync(script, 0o755)
		return script
	}

	for (const [description, { file, git, committed, refused }] of Object.entries(committedCases)) {
		it(description, () => {
			const repository = repositoryOfTheCase()
			const command =
				git === 'dubious-ownership' ? dubiousOwnershipGit({ directory: repository }) : git
			const asked = function askGit(): boolean {
				return committedInGit({ file: file({ repository }), git: command })
			}
			if (refused) expect(asked).toThrow()
			else expect(asked()).toBe(committed)
		})
	}

	it('asked inside a git hook (its variables naming another repository and index) → answered for the file’s own repository', () => {
		const repository = repositoryOfTheCase()
		vi.stubEnv('GIT_DIR', join(tmpdir(), `dialecte-no-repository-${crypto.randomUUID()}`))
		vi.stubEnv('GIT_INDEX_FILE', 'index.lock')
		onTestFinished(function restoreEnvironment() {
			vi.unstubAllEnvs()
		})
		expect(committedInGit({ file: join(repository, 'tracked.txt') })).toBe(true)
	})
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
