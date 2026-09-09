/**
 * Stress-fixture generator for core method benchmarks (deepClone / commit / import).
 *
 * Reuses the test system's "Rule of 3" naming (`A → AA_1 → AAA_1 → …`) but drives it
 * from a rule engine in this script instead of the committed schema — so the schema
 * and its generated definition stay untouched for the normal test suite. The invented
 * branches (`A..Z`) and extra depth are elements the core config does not declare;
 * `standardizeRecord` returns such records verbatim (no fills, no error), so import +
 * clone operate on them structurally. That is exactly what we want to stress: raw node
 * count and tree depth, not schema standardization.
 *
 * The files are large (up to 500 MB) — they are NOT source-controlled. Only this script
 * is. Generated output lands in `./data/` (git-ignored); run on demand before a perf run:
 *
 *   npx tsx src/test/fixtures/generate-stress-fixtures.ts            # 5/10/50/100/200/500 MB
 *   npx tsx src/test/fixtures/generate-stress-fixtures.ts 5 50       # only those sizes
 *
 * Core-agnostic: the shape is parameterized by {@link StressShape}; another dialecte can
 * import {@link generateStressXml} and pass its own namespace / attribute payload.
 */
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_NAMESPACE_URI = 'http://dialecte.dev/XML/DEFAULT'
// Branches D..Z only: A/B/C (and their descendants) are the config's KNOWN elements with
// real facets (fixed/enum/pattern/identity), so a generic payload would fail
// standardization on clone. D..Z are unknown → returned verbatim → pure structural stress.
const ALPHABET = 'DEFGHIJKLMNOPQRSTUVWXYZ'
// Greater arrangement: fine steps up to 100 MB, then 100-MB steps to 500 MB.
const DEFAULT_SIZES_MB = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500]

/** Tunables for the generated tree — kept small so byte size scales predictably. */
export type StressShape = {
	/** Root's `xmlns`. */
	namespaceUri: string
	/** Children per node inside a block. Low so a depth-`maxDepth` block stays modest,
	 * which keeps MANY blocks per file (breadth at the Root — how real SCL scales). */
	breadth: number
	/** Depth of every block. Kept CONSTANT (not size-correlated) at a realistic value. */
	baseDepth: number
	/** Cap on block depth. Equal to `baseDepth` here → every block has the same depth. */
	maxDepth: number
}

// Depth is FIXED at ~real production (max SCL nesting ~8-10) + a bit, and does NOT grow
// with file size — bigger files add more blocks (breadth at Root), not deeper nodes.
// This matches how real SCL scales (many records at bounded depth), unlike a generator
// where size↑ ⇒ depth↑ (which would stress an axis production never hits).
const DEFAULT_SHAPE: StressShape = {
	namespaceUri: DEFAULT_NAMESPACE_URI,
	breadth: 2,
	baseDepth: 10,
	maxDepth: 10,
}

type BlockResult = { xml: string; nodes: number }

/** Tag for branch `letter` at `depth` (0 = the branch itself): `A`, `AA_1`, `AAA_1`, … */
function tagFor(letter: string, depth: number, childIndex: number): string {
	const name = letter.repeat(depth + 1)
	return depth === 0 ? name : `${name}_${childIndex}`
}

/** One Rule-of-3 block: a self-similar subtree rooted at `letter`, depth-bounded. */
function emitBlock(
	letter: string,
	depth: number,
	maxDepth: number,
	shape: StressShape,
): BlockResult {
	let nodes = 1
	const openTag = depth === 0 ? letter : tagFor(letter, depth, 0)
	// A couple of attributes per node give a realistic payload (and byte weight).
	const attrs = ` a${openTag}="x" b${openTag}="y"`

	if (depth >= maxDepth) return { xml: `<${openTag}${attrs}/>`, nodes }

	let children = ''
	for (let k = 1; k <= shape.breadth; k++) {
		const sub = emitChild(letter, depth + 1, k, maxDepth, shape)
		nodes += sub.nodes
		children += sub.xml
	}
	return { xml: `<${openTag}${attrs}>${children}</${openTag}>`, nodes }
}

/** A child node at `depth` with sibling index `k`; recurses to `maxDepth`. */
function emitChild(
	letter: string,
	depth: number,
	k: number,
	maxDepth: number,
	shape: StressShape,
): BlockResult {
	const tag = tagFor(letter, depth, k)
	const attrs = ` a${tag}="x" b${tag}="y"`
	if (depth >= maxDepth) return { xml: `<${tag}${attrs}/>`, nodes: 1 }

	let nodes = 1
	let children = ''
	for (let c = 1; c <= shape.breadth; c++) {
		const sub = emitChild(letter, depth + 1, c, maxDepth, shape)
		nodes += sub.nodes
		children += sub.xml
	}
	return { xml: `<${tag}${attrs}>${children}</${tag}>`, nodes }
}

/** Awaitable `stream.write` that honors backpressure. */
function write(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(chunk, (err) => (err ? reject(err) : resolve()))
	})
}

/**
 * Stream a well-formed stress document to `outPath` until it reaches ~`targetBytes`.
 * Every block has the SAME (realistic, ~10) depth; file size grows by emitting MORE
 * blocks (Root breadth), not deeper trees. Returns the node count + byte size.
 */
export async function generateStressXml(params: {
	outPath: string
	targetBytes: number
	shape?: StressShape
}): Promise<{ nodes: number; bytes: number }> {
	const shape = params.shape ?? DEFAULT_SHAPE
	await mkdir(dirname(params.outPath), { recursive: true })
	const stream = createWriteStream(params.outPath, { encoding: 'utf8' })

	const header = `<?xml version="1.0" encoding="UTF-8"?>\n<Root xmlns="${shape.namespaceUri}">`
	const footer = `</Root>\n`
	await write(stream, header)

	let bytes = Buffer.byteLength(header) + Buffer.byteLength(footer)
	let nodes = 1 // Root
	let buffer = ''
	let blockIndex = 0
	const FLUSH_AT = 8 * 1024 * 1024 // 8 MB buffer before a stream write

	while (bytes < params.targetBytes) {
		const letter = ALPHABET[blockIndex % ALPHABET.length]
		// Constant depth (not size-correlated): every block is a realistic-depth subtree.
		const depth = shape.maxDepth
		const block = emitBlock(letter, 0, depth, shape)
		buffer += block.xml
		nodes += block.nodes
		bytes += Buffer.byteLength(block.xml)
		blockIndex++

		if (buffer.length >= FLUSH_AT) {
			await write(stream, buffer)
			buffer = ''
		}
	}

	if (buffer) await write(stream, buffer)
	await write(stream, footer)
	await new Promise<void>((resolve, reject) =>
		stream.end((err?: Error) => (err ? reject(err) : resolve())),
	)
	return { nodes, bytes }
}

async function main(): Promise<void> {
	const here = dirname(fileURLToPath(import.meta.url))
	const dataDir = join(here, 'data')
	const argSizes = process.argv
		.slice(2)
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0)
	const sizes = argSizes.length > 0 ? argSizes : DEFAULT_SIZES_MB

	for (const mb of sizes) {
		const outPath = join(dataDir, `stress-${mb}mb.xml`)
		const start = performance.now()
		const { nodes, bytes } = await generateStressXml({ outPath, targetBytes: mb * 1024 * 1024 })
		const ms = Math.round(performance.now() - start)
		const actualMb = (bytes / (1024 * 1024)).toFixed(1)
		console.log(`${outPath}  —  ${actualMb} MB, ${nodes.toLocaleString()} nodes, ${ms} ms`)
	}
}

// Run only when invoked directly (not when imported by a dialecte's own generator).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
