/**
 * Run by `_check-npm-version.yml` on the push to main, the commit the push started from fetched: gathers the facts (the
 * version before the push, read from BEFORE; npm's dist-tags and versions; whether the release tag is on origin),
 * decides, and writes `publish`, `dist_tag` and `tag` to GITHUB_OUTPUT. A refusal or a failed lookup fails the step
 * with its reason; nothing is hidden.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

import { LS_REMOTE_FOUND, LS_REMOTE_MISSING } from './publish-decision.constants.ts'
import { decidePublish, readNpmView } from './publish-decision.ts'

import type { NpmViewResult, PublishDecision } from './publish-decision.types.ts'

/** A command's exit code and both streams; a command that cannot start exits 1 with its error. */
function runCommand(params: { command: string; args: readonly string[] }): NpmViewResult {
	const result = spawnSync(params.command, params.args, { encoding: 'utf8' })
	if (result.error !== undefined) return { exitCode: 1, stdout: '', stderr: result.error.message }
	return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** The name and version of a package.json text. */
function readPackage(text: string): { name: string; version: string } {
	const parsed: unknown = JSON.parse(text)
	if (typeof parsed !== 'object' || parsed === null)
		throw new Error('package.json is not an object')
	const name: unknown = Reflect.get(parsed, 'name')
	const version: unknown = Reflect.get(parsed, 'version')
	if (typeof name !== 'string' || typeof version !== 'string')
		throw new Error('package.json lacks name or version')
	return { name, version }
}

/** The command's stdout, or an error naming the command and its stderr. */
function stdoutOf(params: { command: string; args: readonly string[] }): string {
	const result = runCommand(params)
	if (result.exitCode !== 0) {
		throw new Error(
			`${params.command} ${params.args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`,
		)
	}
	return result.stdout
}

/** Whether origin has the release tag; a lookup that fails throws. */
function tagOnOrigin(tag: string): boolean {
	const args = ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]
	const result = runCommand({ command: 'git', args })
	if (result.exitCode === LS_REMOTE_FOUND) return true
	if (result.exitCode === LS_REMOTE_MISSING) return false
	throw new Error(`git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`)
}

/** The step outputs of a decision. */
function outputsOf(decision: PublishDecision): string {
	const publish = decision.action === 'publish'
	const distTag = decision.action === 'publish' ? decision.distTag : 'latest'
	const tag = publish || decision.action === 'tag'
	return `publish=${publish}\ndist_tag=${distTag}\ntag=${tag}\n`
}

/** Gathers the facts, decides, writes the outputs; exit 1 with the reason on a refusal or a failed lookup. */
function main(): void {
	const before = process.env.BEFORE ?? ''
	const outputFile = process.env.GITHUB_OUTPUT ?? ''
	if (before === '' || outputFile === '') throw new Error('BEFORE and GITHUB_OUTPUT must be set')
	const current = readPackage(readFileSync('package.json', 'utf8'))
	const previous = readPackage(
		stdoutOf({ command: 'git', args: ['show', `${before}:package.json`] }),
	)
	const registry = readNpmView(
		runCommand({ command: 'npm', args: ['view', current.name, 'dist-tags', 'versions', '--json'] }),
	)
	const tag = `${current.name.replace(/.*\//, '')}@v${current.version}`
	const decision = decidePublish({
		previousVersion: previous.version,
		currentVersion: current.version,
		registry,
		tagExists:
			registry.kind === 'present' &&
			registry.versions.includes(current.version) &&
			tagOnOrigin(tag),
	})
	process.stdout.write(
		`${current.name} ${previous.version} -> ${current.version}: ${decision.action} (${decision.reason})\n`,
	)
	if (decision.action === 'refuse') {
		process.exitCode = 1
		return
	}
	appendFileSync(outputFile, outputsOf(decision))
}

try {
	main()
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
	process.exitCode = 1
}
