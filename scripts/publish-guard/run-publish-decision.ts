/**
 * Run by `_check-npm-version.yml` on the push to main, the commit the push started from fetched: gives the publish
 * decision the real process (environment, files, git and npm, GITHUB_OUTPUT, the terminal) and exits with its code.
 * Anything that throws fails the step with its reason; nothing is hidden.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

import { runPublishDecision } from './publish-decision.ts'

import type { CommandResult } from './publish-decision.types.ts'

/** A command's exit code and both streams; a command that cannot start exits 1 with its error. */
function runCommand(params: { command: string; args: readonly string[] }): CommandResult {
	const result = spawnSync(params.command, params.args, { encoding: 'utf8' })
	if (result.error !== undefined) return { exitCode: 1, stdout: '', stderr: result.error.message }
	return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** A file's text. */
function readText(path: string): string {
	return readFileSync(path, 'utf8')
}

/** Appends the step outputs to GITHUB_OUTPUT. */
function appendOutput(params: { file: string; text: string }): void {
	appendFileSync(params.file, params.text)
}

/** One line on a stream. */
function printLine(params: { stream: 'stdout' | 'stderr'; line: string }): void {
	process[params.stream].write(`${params.line}\n`)
}

try {
	process.exitCode = runPublishDecision({
		environment: process.env,
		readFile: readText,
		run: runCommand,
		appendOutput,
		print: printLine,
	})
} catch (error) {
	printLine({ stream: 'stderr', line: error instanceof Error ? error.message : String(error) })
	process.exitCode = 1
}
