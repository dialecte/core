#!/usr/bin/env node
/*
Simple Node.js + TypeScript script to find global <xs:element> declarations
whose `type` is a `xs:complexType` defined in the same XSD, and which are
NOT referenced as an <xs:element ref="..."> child elsewhere in the file.

Usage (from repository root):

  # install runtime dep (one-time)
  pnpm -w add xmldom

  # run with ts-node (preferred) or compile with tsc
  npx ts-node packages/sclsdk/src/script/find-unreferenced-elements.ts packages/sclsdk/src/script/xsd/IEC61850-6-100.xsd

Or compile:
  npx tsc packages/sclsdk/src/script/find-unreferenced-elements.ts --esModuleInterop
  node packages/sclsdk/src/script/find-unreferenced-elements.js packages/sclsdk/src/script/xsd/IEC61850-6-100.xsd
*/

import fs from 'node:fs'
import path from 'node:path'

import { DOMParser } from '@xmldom/xmldom'

function localName(qname: string | null): string | null {
	if (!qname) return null
	const parts = qname.split(':')
	return parts[parts.length - 1]
}

function main() {
	const args = process.argv.slice(2)
	if (args.length < 1) {
		console.error('Usage: find-unreferenced-elements.ts path/to/file.xsd')
		process.exit(2)
	}

	const file = path.resolve(args[0])
	if (!fs.existsSync(file)) {
		console.error('File not found:', file)
		process.exit(2)
	}

	const xml = fs.readFileSync(file, 'utf8')
	const doc = new DOMParser().parseFromString(xml, 'application/xml')
	const root = doc.documentElement
	const XS_NS = 'http://www.w3.org/2001/XMLSchema'

	// collect complexType names defined in this schema
	const complexTypes = new Set<string>()
	const ctNodes = root.getElementsByTagNameNS(XS_NS, 'complexType')
	for (let i = 0; i < ctNodes.length; i++) {
		const n = ctNodes.item(i)!
		const name = n.getAttribute('name')
		if (name) complexTypes.add(name)
	}

	// collect top-level (global) element nodes: direct children of schema root
	const globalElements: Array<{ name: string; type: string | null }> = []
	const allElementNodes = root.getElementsByTagNameNS(XS_NS, 'element')
	for (let i = 0; i < allElementNodes.length; i++) {
		const el = allElementNodes.item(i)!
		// top-level if parent is the schema root
		if (el.parentNode === root) {
			const name = el.getAttribute('name')
			const type = el.getAttribute('type')
			if (name) globalElements.push({ name, type: type || null })
		}
	}

	// filter globals whose type references a complexType defined in this file
	const globalsWithComplexType = globalElements.filter((g) => {
		if (!g.type) return false
		const tLocal = localName(g.type)
		return !!tLocal && complexTypes.has(tLocal)
	})

	// collect referenced element names via ref attributes anywhere
	const referenced = new Set<string>()
	for (let i = 0; i < allElementNodes.length; i++) {
		const el = allElementNodes.item(i)!
		const ref = el.getAttribute('ref')
		if (ref) {
			const rLocal = localName(ref)
			if (rLocal) referenced.add(rLocal)
		}
	}

	// Also consider local element usages where a child element has a type equal
	// to a global element's type, or where a local element has the same name
	// as a global element (and is not top-level). These count as the global
	// being 'used as a child' even if via inline declaration.
	const globalTypeByName = new Map<string, string>()
	for (const g of globalElements) {
		if (g.type) {
			const local = localName(g.type)
			if (local) globalTypeByName.set(g.name, local)
		}
	}

	for (let i = 0; i < allElementNodes.length; i++) {
		const el = allElementNodes.item(i)!
		// if this element is not a top-level global, check its name/type
		if (el.parentNode !== root) {
			const name = el.getAttribute('name')
			if (name && globalElements.some((g) => g.name === name)) {
				referenced.add(name)
			}
			const type = el.getAttribute('type')
			if (type) {
				const tLocal = localName(type)
				for (const [gname, gtypeLocal] of globalTypeByName.entries()) {
					if (gtypeLocal === tLocal) referenced.add(gname)
				}
			}
		}
	}

	// compute unreferenced globals
	const unreferenced = globalsWithComplexType.filter((g) => !referenced.has(g.name))

	console.log(`Parsed: ${file}`)
	console.log(`Complex types defined: ${complexTypes.size}`)
	console.log(`Global elements: ${globalElements.length}`)
	console.log(`Globals whose type is a complexType: ${globalsWithComplexType.length}`)
	console.log(`Element refs found: ${referenced.size}`)
	console.log('')

	if (unreferenced.length) {
		console.log('Global elements (type=complexType) not referenced as xs:element ref anywhere:')
		for (const g of unreferenced) console.log(' -', g.name, 'type=', g.type)
	} else {
		console.log('None — all global elements with complexType are referenced via ref.')
	}
}

// ES module friendly entry point when using `tsx` or ESM loader
if (process.argv[1] && process.argv[1].endsWith('find-unreferenced-elements.ts')) {
	main()
}
