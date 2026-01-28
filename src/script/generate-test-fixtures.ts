/**
 * generate-test-fixtures.ts
 *
 * Generates TypeScript types and constants from the test DEFINITION constant.
 *
 * Steps:
 * 1. Import DEFINITION from definition.ts
 * 2. Write it to a temporary JSON file
 * 3. Run generate-definition.ts on it (with empty MAPPING for test fixtures)
 * 4. Clean up temp file
 *
 * Usage:
 *   node --import=tsx src/script/generate-test-fixtures.ts
 */

import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { DEFINITION } from '../helpers/test-fixtures/generated/definition.js'

const TEMP_JSON = resolve(import.meta.dirname, '../helpers/test-fixtures/definition.temp.json')
const TEMP_MAPPING = resolve(import.meta.dirname, './element-parent-mapping.temp.ts')
const OUTPUT_DIR = resolve(import.meta.dirname, '../helpers/test-fixtures/generated')

async function main(): Promise<void> {
	console.log('[test-fixtures] Writing DEFINITION to temp JSON...')
	await writeFile(TEMP_JSON, JSON.stringify(DEFINITION, null, '\t'), 'utf-8')

	console.log('[test-fixtures] Creating empty mapping for test fixtures...')
	await writeFile(TEMP_MAPPING, 'export const MAPPING = {}', 'utf-8')

	console.log('[test-fixtures] Generating types and constants...')

	// Override process.argv to pass args to generate-definition
	const originalArgv = process.argv
	process.argv = [process.argv[0], process.argv[1], '--in', TEMP_JSON, '--out', OUTPUT_DIR]

	try {
		// Dynamically import to pick up temp mapping file
		const { main: generateDefinition } = await import('./generate-definition.js')
		await generateDefinition()
	} finally {
		// Restore original argv
		process.argv = originalArgv

		// Clean up temp files
		console.log('[test-fixtures] Cleaning up temp files...')
		await unlink(TEMP_JSON).catch(() => {})
		await unlink(TEMP_MAPPING).catch(() => {})
	}

	console.log('[test-fixtures] ✓ Done!')
}

main().catch((error: unknown) => {
	console.error(error)
	process.exit(1)
})
