#!/usr/bin/env node --import=tsx

/**
 * Test script to parse XSD using Pyodide
 *
 * Usage:
 *   node --import=tsx src/script/test-pyodide.ts --xsd path/to/schema.xsd --out output.json
 */

import { parseArgs } from 'util'

import { parseXsdWithPython } from './pyodide'

async function main() {
	const { values } = parseArgs({
		options: {
			xsd: { type: 'string', short: 'x' },
			out: { type: 'string', short: 'o' },
		},
	})

	if (!values.xsd || !values.out) {
		console.error('Usage: node --import=tsx test-pyodide.ts --xsd <xsd-path> --out <output-path>')
		process.exit(1)
	}

	try {
		const result = await parseXsdWithPython({
			xsdPath: values.xsd,
			outputPath: values.out,
		})

		console.log(`\n✅ Success! Parsed ${Object.keys(result).length} elements`)
		console.log(`Output written to: ${values.out}`)
	} catch (error) {
		console.error('❌ Failed:', error)
		process.exit(1)
	}
}

main()
