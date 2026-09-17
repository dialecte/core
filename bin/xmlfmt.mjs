#!/usr/bin/env node
// Reformat the XML embedded in `/* xml */` template literals across the matched files, using the
// shared core formatter. One structural tag per line, indented, text leaves inline; interpolations
// (${ns}/${id}) and text values preserved. A snippet the parser cannot handle is left untouched.
//
//   dialecte-xmlfmt 'src/**/*.test.ts'            # rewrite in place
//   dialecte-xmlfmt --check 'src/**/*.test.ts'    # exit 1 if any file is not formatted (CI gate)
import { globSync, readFileSync, writeFileSync } from 'node:fs'

import { formatEmbeddedXml } from '../dist/utils.js'

const args = process.argv.slice(2)
const check = args.includes('--check')
const patterns = args.filter((arg) => !arg.startsWith('--'))

if (patterns.length === 0) {
	console.error("usage: dialecte-xmlfmt [--check] <glob>...  (e.g. 'src/**/*.test.ts')")
	process.exit(2)
}

const files = [...new Set(patterns.flatMap((pattern) => globSync(pattern)))]
const changed = []
for (const file of files) {
	const before = readFileSync(file, 'utf8')
	const after = formatEmbeddedXml(before)
	if (after === before) continue
	changed.push(file)
	if (!check) writeFileSync(file, after)
}

if (check && changed.length > 0) {
	console.error(`dialecte-xmlfmt: ${changed.length} file(s) not formatted:`)
	for (const file of changed) console.error(`  ${file}`)
	process.exit(1)
}
console.log(
	check
		? 'dialecte-xmlfmt: all files formatted.'
		: `dialecte-xmlfmt: formatted ${changed.length} file(s).`,
)
