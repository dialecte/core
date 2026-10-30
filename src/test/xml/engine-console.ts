import { ENGINE_CONSOLE_STATE_KEY } from './xml.constants'

import type { ConsoleWriter, EngineConsoleState, QuietEngineCall } from './xml.types'

/**
 * libxml2-wasm binds `console.log` and `console.error` once, while its module loads, and writes the engine's
 * own diagnostics there (`XPath error : ...` on a refused expression). This module is evaluated before the engine
 * has bound them (the seam's engine module imports it first, and the build bundles the engine to keep that
 * order): it puts forwarders on the console for the engine to bind, and the seam puts the console back once the
 * engine is loaded. A forwarder writes what it gets through, except during a seam call, which holds
 * the engine's lines back and gives them to its error instead.
 */
let replacedLog: ConsoleWriter | undefined
let replacedError: ConsoleWriter | undefined

installConsoleForwarders()

function installConsoleForwarders(): void {
	replacedLog = console.log
	replacedError = console.error
	console.log = forwardEngineLog
	console.error = forwardEngineError
}

/** Puts the console writers back once the engine has bound the forwarders. */
export function restoreConsoleAfterEngineLoad(): void {
	if (console.log === forwardEngineLog && replacedLog) console.log = replacedLog
	if (console.error === forwardEngineError && replacedError) console.error = replacedError
}

/** Runs an engine call with what the engine writes held back; an error comes back with those lines. */
export function runEngineQuietly<GenericValue>(
	run: () => GenericValue,
): QuietEngineCall<GenericValue> {
	const state = readEngineConsoleState()
	const heldBefore = state.heldLines.length
	state.quietCalls += 1
	try {
		return { completed: true, value: run() }
	} catch (error) {
		return { completed: false, error, engineLines: state.heldLines.slice(heldBefore) }
	} finally {
		state.quietCalls -= 1
		if (state.quietCalls === 0) state.heldLines.length = 0
	}
}

function forwardEngineLog(...data: unknown[]): void {
	holdOrWrite({ data, write: replacedLog })
}

function forwardEngineError(...data: unknown[]): void {
	holdOrWrite({ data, write: replacedError })
}

function holdOrWrite(params: { data: unknown[]; write: ConsoleWriter | undefined }): void {
	const { data, write } = params
	const state = readEngineConsoleState()
	if (state.quietCalls > 0) {
		state.heldLines.push(data.map(String).join(' '))
		return
	}
	if (write) Reflect.apply(write, console, data)
}

function readEngineConsoleState(): EngineConsoleState {
	const holder = globalThis as typeof globalThis & {
		[ENGINE_CONSOLE_STATE_KEY]?: EngineConsoleState
	}
	holder[ENGINE_CONSOLE_STATE_KEY] ??= { quietCalls: 0, heldLines: [] }
	return holder[ENGINE_CONSOLE_STATE_KEY]
}
