/**
 * Node side of the layout bench (vitest browser commands): machine load and the quiet-machine wait,
 * one result file per run, the fixtures (record counts checked), the device, and a CPU profile of the
 * bench worker over CDP for the GC share.
 *
 * Fixtures are read, never written here:
 * - structural: `src/test/fixtures/data/stress-<n>mb.xml`, written by `src/test/fixtures/generate-stress-fixtures.ts`;
 * - composed (indented, as exported): `scl-composed-<n>mb.scd` and `composed-small-catalogue.scd` in the folder
 *   named by `BENCH_SCL_FIXTURES_DIR`;
 * - composed compact: `src/test/fixtures/data/scl-composed-<n>mb-compact.scd`, the indented file with every
 *   whitespace-only text run dropped and every text value trimmed (markup copied as is); its record count must equal
 *   its source's, which `benchFixture` checks.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, platform, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FIXTURE_SOURCES, PROFILE_TOP_FUNCTIONS, XML_BYTES } from './bench.constants'

import type {
	BenchCpuProfile,
	BenchFixture,
	BenchFixtureName,
	BenchProfileState,
	GcShare,
} from './bench.types'
import type { BrowserCommand, BrowserCommandContext } from 'vitest/node'

const CORE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const CORE_FIXTURES = join(CORE_ROOT, 'src/test/fixtures/data')
//====== MACHINE ======//

/** Swap in use (macOS `sysctl vm.swapusage`); undefined on other systems or when it cannot be read. */
function swapUsedMiB(): number | undefined {
	if (platform() !== 'darwin') return undefined
	try {
		const usage = execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' })
		const used = /used = ([\d.]+)M/.exec(usage)
		return used ? Number(used[1]) : undefined
	} catch {
		return undefined
	}
}

const benchMachine: BrowserCommand<[]> = async function benchMachine() {
	return { load: loadavg(), swapUsedMiB: swapUsedMiB() }
}

const benchWaitForQuiet: BrowserCommand<[{ maxLoad: number; maxWaitMs: number }]> =
	async function benchWaitForQuiet(_context, { maxLoad, maxWaitMs }) {
		const startedAt = Date.now()
		while (loadavg()[0]! >= maxLoad && Date.now() - startedAt < maxWaitMs)
			await new Promise((done) => setTimeout(done, 10_000))
		return { waitedMs: Date.now() - startedAt, load: loadavg() }
	}

function browserName(context: BrowserCommandContext): string {
	return context.context.browser()?.browserType().name() ?? 'unknown'
}

const benchDevice: BrowserCommand<[]> = async function benchDevice(context) {
	const [cpu] = cpus()
	return {
		cpus: cpus().length,
		cpuModel: cpu?.model ?? 'unknown',
		totalMemoryGiB: totalmem() / 1024 ** 3,
		platform: platform(),
		osRelease: release(),
		browser: browserName(context),
		browserVersion: context.context.browser()?.version() ?? 'unknown',
	}
}

//====== RESULTS ======//

/** One file per run, never overwritten: `<dir>/<browser>/<name>.<ISO time>.json`. */
const benchRecord: BrowserCommand<[{ name: string; data: unknown }]> = async function benchRecord(
	context,
	{ name, data },
) {
	const directory = join(
		process.env.BENCH_RESULTS_DIR ?? join(CORE_ROOT, '.tmp/bench-results'),
		browserName(context),
	)
	mkdirSync(directory, { recursive: true })
	const at = new Date().toISOString()
	const path = join(directory, `${name}.${at.replaceAll(':', '-')}.json`)
	writeFileSync(path, JSON.stringify({ at, ...(data as object) }, null, '\t'))
	return path
}

//====== FIXTURES ======//

function sclFixtureDirectory(): string {
	const directory = process.env.BENCH_SCL_FIXTURES_DIR
	if (!directory) throw new Error('BENCH_SCL_FIXTURES_DIR: the folder of the scl composed fixtures')
	return directory
}

function fixtureKind(params: { name: BenchFixtureName }): keyof typeof FIXTURE_SOURCES {
	const { name } = params
	if (name.startsWith('structural')) return 'structural'
	return name.endsWith('-compact') ? 'compact' : 'composed'
}

/** Where a fixture is read; a compact one names the indented file it was written from. */
export function fixturePath(params: { name: BenchFixtureName }): {
	path: string
	compactOf?: string
} {
	const { name } = params
	if (name === 'composed-catalogue-small')
		return { path: join(sclFixtureDirectory(), 'composed-small-catalogue.scd') }
	const structural = /^structural-(\d+)$/.exec(name)
	if (structural) return { path: join(CORE_FIXTURES, `stress-${structural[1]}mb.xml`) }
	const [, size, form] = /^composed-(\d+)-(indented|compact)$/.exec(name)!
	const indented = join(sclFixtureDirectory(), `scl-composed-${size}mb.scd`)
	if (form === 'indented') return { path: indented }
	return { path: join(CORE_FIXTURES, `scl-composed-${size}mb-compact.scd`), compactOf: indented }
}

/**
 * Walk the bytes outside quoted attribute values: element starts (records), and the text between
 * tags, which `onText` gets as one run (whitespace-only runs and the padding of text values are
 * what the compact arm drops).
 */
export async function scanXml(params: {
	path: string
	onText?: (text: Buffer) => void
	onMarkup?: (markup: Buffer) => void
}): Promise<number> {
	const { path, onText, onMarkup } = params
	let records = 0
	let inTag = false
	// the byte after a `<` tells an element start from an end tag, comment or declaration
	let afterLt = false
	let quote = 0
	let text: Buffer[] = []
	let markup: Buffer[] = []
	for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
		let start = 0
		for (let index = 0; index < chunk.length; index++) {
			const byte = chunk[index]!
			if (afterLt) {
				afterLt = false
				if (byte !== XML_BYTES.slash && byte !== XML_BYTES.bang && byte !== XML_BYTES.question)
					records += 1
			}
			if (inTag) {
				if (quote) {
					if (byte === quote) quote = 0
				} else if (byte === XML_BYTES.quote || byte === XML_BYTES.apostrophe) {
					quote = byte
				} else if (byte === XML_BYTES.gt) {
					inTag = false
					markup.push(chunk.subarray(start, index + 1))
					onMarkup?.(Buffer.concat(markup))
					markup = []
					start = index + 1
				}
			} else if (byte === XML_BYTES.lt) {
				text.push(chunk.subarray(start, index))
				onText?.(Buffer.concat(text))
				text = []
				inTag = true
				afterLt = true
				start = index
			}
		}
		if (inTag) markup.push(chunk.subarray(start))
		else text.push(chunk.subarray(start))
	}
	return records
}

const fixtureCache = new Map<string, BenchFixture>()

const benchFixture: BrowserCommand<[{ name: BenchFixtureName }]> = async function benchFixture(
	_context,
	{ name },
) {
	const cached = fixtureCache.get(name)
	if (cached) return cached
	const { path, compactOf } = fixturePath({ name })
	if (!existsSync(path))
		throw new Error(`fixture ${name} missing at ${path}: ${FIXTURE_SOURCES[fixtureKind({ name })]}`)
	const records = await scanXml({ path })
	if (compactOf) {
		const sourceRecords = await scanXml({ path: compactOf })
		if (sourceRecords !== records)
			throw new Error(`compact ${path}: ${records} records, its source ${sourceRecords}`)
	}
	const fixture = { name, path, url: `/@fs${path}`, bytes: statSync(path).size, records }
	fixtureCache.set(name, fixture)
	return fixture
}

//====== CPU PROFILE ======//

let profiling: BenchProfileState | undefined

/** Commands go to the worker through the page session: auto-attach without flatten. */
function sendToWorker<GenericResult>(params: {
	state: BenchProfileState
	method: string
	params?: object
}): Promise<GenericResult> {
	const { state, method } = params
	const id = (state.nextId += 1)
	return new Promise((done, failed) => {
		state.pending.set(id, (message) =>
			message.error
				? failed(new Error(message.error.message))
				: done(message.result as GenericResult),
		)
		void state.session.send('Target.sendMessageToTarget', {
			sessionId: state.workerSessionId,
			message: JSON.stringify({ id, method, params: params.params ?? {} }),
		})
	})
}

const benchProfileStart: BrowserCommand<
	[{ workerUrlIncludes: string; samplingIntervalUs: number }]
> = async function benchProfileStart(context, { workerUrlIncludes, samplingIntervalUs }) {
	const session = await context.context.newCDPSession(context.page)
	const pending: BenchProfileState['pending'] = new Map()
	const attached = new Promise<string>((done, failed) => {
		setTimeout(() => failed(new Error(`no worker matching ${workerUrlIncludes}`)), 10_000)
		session.on('Target.attachedToTarget', (event) => {
			if (event.targetInfo.type === 'worker' && event.targetInfo.url.includes(workerUrlIncludes))
				done(event.sessionId)
		})
	})
	session.on('Target.receivedMessageFromTarget', (event) => {
		const message = JSON.parse(event.message) as {
			id?: number
			result?: unknown
			error?: { message: string }
		}
		if (message.id === undefined) return
		pending.get(message.id)?.(message)
		pending.delete(message.id)
	})
	await session.send('Target.setAutoAttach', {
		autoAttach: true,
		waitForDebuggerOnStart: false,
		flatten: false,
	})
	const state: BenchProfileState = { session, workerSessionId: await attached, nextId: 0, pending }
	await sendToWorker({ state, method: 'Profiler.enable' })
	await sendToWorker({
		state,
		method: 'Profiler.setSamplingInterval',
		params: { interval: samplingIntervalUs },
	})
	await sendToWorker({ state, method: 'Profiler.start' })
	profiling = state
}

/** Self time per node from the samples, then the GC share of the worker's busy time. */
function summarizeProfile(params: {
	profile: BenchCpuProfile
	gcNode: string
	idleNodes: string[]
	namedFunctions: string[]
}): GcShare {
	const { profile, gcNode, idleNodes, namedFunctions } = params
	const nameById = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]))
	const selfMs = new Map<string, number>()
	for (let index = 0; index < profile.samples.length; index++) {
		const deltaUs = profile.timeDeltas[index + 1] ?? 0
		const name = nameById.get(profile.samples[index]!) ?? ''
		selfMs.set(name, (selfMs.get(name) ?? 0) + deltaUs / 1000)
	}
	const sampledMs = [...selfMs.values()].reduce((sum, ms) => sum + ms, 0)
	const idleMs = idleNodes.reduce((sum, name) => sum + (selfMs.get(name) ?? 0), 0)
	const gcMs = selfMs.get(gcNode) ?? 0
	const busyMs = sampledMs - idleMs
	return {
		gcMs,
		busyMs,
		idleMs,
		sampledMs,
		share: busyMs > 0 ? gcMs / busyMs : 0,
		named: Object.fromEntries(namedFunctions.map((name) => [name, selfMs.get(name) ?? 0])),
		top: [...selfMs.entries()]
			.sort(([, left], [, right]) => right - left)
			.slice(0, PROFILE_TOP_FUNCTIONS)
			.map(([name, ms]) => ({ name: name || '(anonymous)', ms })),
	}
}

const benchProfileStop: BrowserCommand<
	[{ gcNode: string; idleNodes: string[]; namedFunctions: string[] }]
> = async function benchProfileStop(_context, { gcNode, idleNodes, namedFunctions }) {
	const state = profiling
	if (!state) throw new Error('no profile running')
	profiling = undefined
	try {
		const { profile } = await sendToWorker<{ profile: BenchCpuProfile }>({
			state,
			method: 'Profiler.stop',
		})
		return summarizeProfile({ profile, gcNode, idleNodes, namedFunctions })
	} finally {
		await state.session.detach()
	}
}

export const BENCH_COMMANDS = {
	benchMachine,
	benchWaitForQuiet,
	benchRecord,
	benchDevice,
	benchFixture,
	benchProfileStart,
	benchProfileStop,
}
