#!/usr/bin/env node
/**
 * generate-definition.ts
 * Reads the monolithic definition JSON (IEC.generated.json or SCL.generated.json)
 * and produces TWO TypeScript files:
 *   1. [name].generated.types.ts - Type declarations and attribute interfaces
 *   2. [name].generated.constants.ts - Runtime constants (REQUIRED_ATTRIBUTES, CHILDREN, PARENTS)
 *
 * This separation allows better tree-shaking and keeps types separate from runtime data.
 *
 * Usage:
 *   node --import=tsx generate-definition.ts \
 *     --in <definition.json> \
 *     --out <output-dir> \
 *     --name <basename>
 *
 * Example:
 *   node --import=tsx src/script/generate-definition.ts \
 *     --in src/generated/IEC.generated.json \
 *     --out src/generated \
 *     --name schema
 *
 *   Generates:
 *     - src/generated/schema.generated.types.ts
 *     - src/generated/schema.generated.constants.ts
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
	SchemaModel,
	IntermediateModel,
	IntermediateAttributeEntry,
	CLIArgs,
} from './generate-definition.types'

// MAPPING will be loaded dynamically
let MAPPING: Record<string, string[]> = {}

function parseArgs(argv: string[]): CLIArgs {
	const args: Partial<CLIArgs> = {}
	for (let i = 2; i < argv.length; i++) {
		const token = argv[i]
		if (token === '--in') args.in = argv[++i]
		else if (token === '--out') args.out = argv[++i]
	}
	if (!args.in || !args.out) {
		console.error('Usage: node generate-schema-types.ts --in <definition.json> --out <output-dir>')
		console.error('Example: --in IEC.json --out src/schema')
		console.error('  Generates: types.generated.ts and constants.generated.ts')
		process.exit(1)
	}
	return args as CLIArgs
}

/**
 * Convert XSD regex pattern to JavaScript regex pattern.
 * Handles XML Schema specific constructs like \i (initial char) and \c (name char).
 * Also handles Unicode character references like &#x0020; (hex) or &#32; (decimal).
 */
function convertXsdPatternToJs(xsdPattern: string): string {
	let jsPattern = xsdPattern

	// Replace XML Schema character classes with JavaScript equivalents
	// \i = XML initial name character (simplified: letters, underscore, colon)
	jsPattern = jsPattern.replace(/\\i/g, '[A-Za-z_:]')

	// \c = XML name character (simplified: letters, digits, dot, dash, underscore, colon)
	jsPattern = jsPattern.replace(/\\c/g, '[-.:0-9A-Z_a-z]')

	// Replace Unicode character references (hex format: &#xHHHH;)
	jsPattern = jsPattern.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => {
		const codePoint = Number.parseInt(hex, 16)
		return String.fromCodePoint(codePoint)
	})

	// Replace Unicode character references (decimal format: &#DDD;)
	jsPattern = jsPattern.replace(/&#(\d+);/g, (_, decimal) => {
		const codePoint = Number.parseInt(decimal, 10)
		return String.fromCodePoint(codePoint)
	})

	return jsPattern
}

/**
 * Merge manual parent-child mappings from MAPPING constant with XSD-derived relationships.
 * MAPPING has format: { childElement: [parentElement1, parentElement2, ...] }
 * This adds children to parent lists and parents to child lists bidirectionally.
 */
function applyManualMapping(
	childElements: Record<string, string[]>,
	parentElements: Record<string, string[]>,
): void {
	for (const [childName, parentNames] of Object.entries(MAPPING)) {
		// Add parents to child's parent list
		if (!parentElements[childName]) {
			parentElements[childName] = []
		}
		for (const parentName of parentNames) {
			if (!parentElements[childName].includes(parentName)) {
				parentElements[childName].push(parentName)
			}
		}

		// Add child to each parent's children list
		for (const parentName of parentNames) {
			if (!childElements[parentName]) {
				childElements[parentName] = []
			}
			if (!childElements[parentName].includes(childName)) {
				childElements[parentName].push(childName)
			}
		}
	}
}

/**
 * Compute all descendants of an element by traversing the CHILDREN graph.
 * Uses BFS to avoid infinite loops and handles cycles.
 */
function computeDescendants(element: string, childrenMap: Record<string, string[]>): string[] {
	const descendants = new Set<string>()
	const queue: string[] = [element]
	const visited = new Set<string>([element])

	while (queue.length > 0) {
		const current = queue.shift()!
		const children = childrenMap[current] || []

		for (const child of children) {
			if (!visited.has(child)) {
				visited.add(child)
				descendants.add(child)
				queue.push(child)
			}
		}
	}

	return Array.from(descendants).sort()
}

/**
 * Compute all ancestors of an element by traversing the PARENTS graph.
 * Uses BFS to avoid infinite loops and handles cycles.
 */
function computeAncestors(element: string, parentsMap: Record<string, string[]>): string[] {
	const ancestors = new Set<string>()
	const queue: string[] = [element]
	const visited = new Set<string>([element])

	while (queue.length > 0) {
		const current = queue.shift()!
		const parents = parentsMap[current] || []

		for (const parent of parents) {
			if (!visited.has(parent)) {
				visited.add(parent)
				ancestors.add(parent)
				queue.push(parent)
			}
		}
	}

	return Array.from(ancestors).sort()
}

function buildModel(definition: SchemaModel): IntermediateModel {
	const elementNames = Object.keys(definition).sort()
	const requiredAttributes: IntermediateModel['requiredAttributes'] = {}
	const attributeDetails: IntermediateModel['attributeDetails'] = {}
	const attributePatterns: IntermediateModel['attributePatterns'] = {}
	const childElements: IntermediateModel['childElements'] = {}
	const parentElements: IntermediateModel['parentElements'] = {}

	for (const elementName of elementNames) {
		const element = definition[elementName]

		const attributeSequence = element.attributes?.sequence || []
		const attributeInfo = element.attributes?.details || {}
		const requiredList: string[] = []
		const attributeBucket: Record<string, IntermediateAttributeEntry> = {}
		const patternBucket: Record<string, string[]> = {}

		for (const attributeName of attributeSequence) {
			const attributeDetail = attributeInfo[attributeName]

			if (!attributeDetail) continue

			if (attributeDetail.required) requiredList.push(attributeName)

			const enumerationValues = attributeDetail.validation?.enumeration || null
			const patternValues = attributeDetail.validation?.pattern || null
			// Filter out generic XML name pattern (\i\c*) as it's essentially "any string"
			const filteredPatterns = Array.isArray(patternValues)
				? patternValues.filter((p) => p !== '\\i\\c*')
				: null
			const patterns = filteredPatterns && filteredPatterns.length > 0 ? filteredPatterns : null

			attributeBucket[attributeName] = {
				required: !!attributeDetail.required,
				enum: Array.isArray(enumerationValues) ? enumerationValues.slice() : null,
				pattern: patterns,
			}

			if (patterns) {
				patternBucket[attributeName] = patterns
			}
		}

		requiredAttributes[elementName] = requiredList
		attributeDetails[elementName] = attributeBucket
		if (Object.keys(patternBucket).length > 0) {
			attributePatterns[elementName] = patternBucket
		}

		const childSequence = element.subElements?.sequence || []
		childElements[elementName] = childSequence.slice()

		parentElements[elementName] = element.parents
	}

	// Apply manual parent-child mappings from MAPPING constant
	applyManualMapping(childElements, parentElements)

	return {
		elementNames,
		requiredAttributes,
		attributeDetails,
		attributePatterns,
		childElements,
		parentElements,
	}
}

function emitTypes(model: IntermediateModel): string {
	const { elementNames, attributeDetails } = model

	const attributeInterfaceBlocks: string[] = []
	const attributeMapEntries: string[] = []

	for (const elementName of elementNames) {
		const elementAttributeDetails = attributeDetails[elementName]
		const lineFragments: string[] = []
		for (const [attributeName, attributeMeta] of Object.entries(elementAttributeDetails)) {
			let typeString: string
			let tsdoc = ''

			// Generate union type for enums, otherwise plain string
			// Patterns are documented but not enforced in the type system
			// Use `string & {}` instead of `string` to preserve autocomplete for union values
			if (attributeMeta.enum && attributeMeta.enum.length) {
				typeString =
					attributeMeta.enum.map((v) => JSON.stringify(v)).join(' | ') + ' | (string & {})'
			} else {
				typeString = 'string'
			}

			// Add pattern documentation if available
			if (attributeMeta.pattern && attributeMeta.pattern.length > 0) {
				const patternDoc =
					attributeMeta.pattern.length === 1
						? `Pattern: ${attributeMeta.pattern[0]}`
						: `Patterns (any of): ${attributeMeta.pattern.join(' | ')}`
				tsdoc = `  /**\n   * ${patternDoc}\n   * @see {@link assertAttributePattern}\n   */\n`
			}

			const optionalFlag = attributeMeta.required ? '' : '?'
			lineFragments.push(`${tsdoc}  '${attributeName}'${optionalFlag}: ${typeString};`)
		}
		attributeInterfaceBlocks.push(
			`export type Attributes${elementName} = {\n${lineFragments.join('\n')}\n}`,
		)
		const quotedMapKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
			? elementName
			: JSON.stringify(elementName)
		attributeMapEntries.push(`  ${quotedMapKey}: Attributes${elementName}`)
	}

	return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by generate-definition.ts
// oxlint-disable-next-line
import type { assertAttributePattern } from '@v1/utils'
import type { ELEMENT_NAMES, REQUIRED_ATTRIBUTES } from 'CONSTANTS_IMPORT_PATH';

export type AvailableElement = typeof ELEMENT_NAMES[number];

${attributeInterfaceBlocks.join('\n\n')}

type AttributesMap = {
	${attributeMapEntries.join(',\n')}
}

export type AttributesOf<T extends AvailableElement> = AttributesMap[T];

// Helper conditional types (require constants)
export type RequiredAttributeNames<T extends AvailableElement> = typeof REQUIRED_ATTRIBUTES[T][number];
export type OptionalAttributeNames<T extends AvailableElement> = Exclude<keyof AttributesOf<T>, RequiredAttributeNames<T>>;
` // end file
}

function emitConstants(model: IntermediateModel): string {
	const { requiredAttributes, attributePatterns, childElements, parentElements, elementNames } =
		model

	const requiredConstEntries = Object.entries(requiredAttributes)
		.map(([elementName, attrArray]) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			return `  ${quotedName}: ${JSON.stringify(attrArray)} as const,`
		})
		.join('\n')

	// Build PATTERNS constant
	const patternsConstEntries: string[] = []
	for (const [elementName, patterns] of Object.entries(attributePatterns)) {
		const quotedElementName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
			? elementName
			: JSON.stringify(elementName)
		const attrPatterns = Object.entries(patterns)
			.map(([attrName, patternArray]) => {
				// Quote attribute name if it contains special characters (like hyphens)
				const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(attrName) ? attrName : `'${attrName}'`

				// Convert each pattern to JS and escape forward slashes
				const regexLiterals = patternArray
					.map((pattern) => {
						const jsPattern = convertXsdPatternToJs(pattern)
						const escapedPattern = jsPattern.replace(/\//g, '\\/')
						return `/${escapedPattern}/`
					})
					.join(', ')

				return `    ${quotedName}: [${regexLiterals}]`
			})
			.join(',\n')
		patternsConstEntries.push(`  ${quotedElementName}: {\n${attrPatterns}\n  } as const`)
	}

	const childrenConstEntries = Object.entries(childElements)
		.map(([elementName, childArray]) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			return `  ${quotedName}: ${JSON.stringify(childArray)} as const,`
		})
		.join('\n')

	const parentConstEntries = Object.entries(parentElements)
		.map(([elementName, parentArray]) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			return `  ${quotedName}: ${JSON.stringify(parentArray)} as const,`
		})
		.join('\n')

	// Build ATTRIBUTES object with all attribute names as keys
	const attributesConstEntries = elementNames
		.map((elementName) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			const attrs = Object.keys(model.attributeDetails[elementName])
			if (attrs.length === 0) {
				return `  ${quotedName}: {} as AttributesOf<${JSON.stringify(elementName)}>,`
			}
			// Create object with all attribute keys (values can be undefined or empty strings as placeholders)
			const attrEntries = attrs.map((attr) => `${JSON.stringify(attr)}: '' as string`).join(', ')
			return `  ${quotedName}: { ${attrEntries} } as AttributesOf<${JSON.stringify(elementName)}>,`
		})
		.join('\n')

	return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by generate-definition.ts

import type { AvailableElement, AttributesOf } from 'TYPES_IMPORT_PATH';

export const ELEMENT_NAMES = [${elementNames.map((name) => JSON.stringify(name)).join(',')}] as const;
export const ELEMENT_NAMES_WITH_ATTRIBUTES_PATTERNS = [${Object.keys(attributePatterns)
		.map((name) => JSON.stringify(name))
		.join(',')}] as const;

export const REQUIRED_ATTRIBUTES = {
${requiredConstEntries}
} as const satisfies Record<AvailableElement, readonly string[]>;

export const PATTERNS = {
${patternsConstEntries.join(',\n')}
} as const satisfies Partial<Record<AvailableElement, Record<string, readonly RegExp[]>>>;

// ATTRIBUTES contains all attribute names for each element
export const ATTRIBUTES = {
${attributesConstEntries}
} as const satisfies { [K in AvailableElement]: AttributesOf<K> };

export const CHILDREN = {
${childrenConstEntries}
} as const satisfies Record<AvailableElement, readonly AvailableElement[]>;

export const PARENTS = {
${parentConstEntries}
} as const satisfies Record<AvailableElement, readonly AvailableElement[]>;
` // end file
}

function emitDescendantsAncestors(
	elementNames: string[],
	childElements: Record<string, string[]>,
	parentElements: Record<string, string[]>,
): string {
	// Compute descendants and ancestors for all elements
	const descendantsMap: Record<string, string[]> = {}
	const ancestorsMap: Record<string, string[]> = {}

	for (const element of elementNames) {
		descendantsMap[element] = computeDescendants(element, childElements)
		ancestorsMap[element] = computeAncestors(element, parentElements)
	}

	const descendantsEntries = elementNames
		.map((elementName) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			const desc = descendantsMap[elementName] || []
			return `  ${quotedName}: ${JSON.stringify(desc)} as const,`
		})
		.join('\n')

	const ancestorsEntries = elementNames
		.map((elementName) => {
			const quotedName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(elementName)
				? elementName
				: JSON.stringify(elementName)
			const anc = ancestorsMap[elementName] || []
			return `  ${quotedName}: ${JSON.stringify(anc)} as const,`
		})
		.join('\n')

	return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Generated by generate-definition.ts

import type { AvailableElement } from './types.generated'

/**
 * DESCENDANTS maps each element to all its possible descendants (children, grandchildren, etc.)
 * Computed by traversing the CHILDREN graph.
 */
export const DESCENDANTS = {
${descendantsEntries}
} as const satisfies Record<AvailableElement, readonly AvailableElement[]>

/**
 * ANCESTORS maps each element to all its possible ancestors (parents, grandparents, etc.)
 * Computed by traversing the PARENTS graph.
 */
export const ANCESTORS = {
${ancestorsEntries}
} as const satisfies Record<AvailableElement, readonly AvailableElement[]>

/**
 * Type helper to get all descendants of an element
 */
export type DescendantsOf<T extends AvailableElement> = typeof DESCENDANTS[T][number]

/**
 * Type helper to get all ancestors of an element
 */
export type AncestorsOf<T extends AvailableElement> = typeof ANCESTORS[T][number]
`
}

export async function main(): Promise<void> {
	const args = parseArgs(process.argv)
	const sourcePath = resolve(args.in)
	const outDir = resolve(args.out)

	const typesBaseName = 'types.generated'
	const constantsBaseName = 'constants.generated'

	// Build file paths
	const typesPath = resolve(outDir, `${typesBaseName}.ts`)
	const constantsPath = resolve(outDir, `${constantsBaseName}.ts`)

	// Try to load MAPPING dynamically
	const tempMappingPath = resolve(import.meta.dirname, './element-parent-mapping.temp.ts')
	const regularMappingPath = resolve(import.meta.dirname, './element-parent-mapping.ts')

	try {
		await access(tempMappingPath)
		// @ts-ignore -- ESM dynamic import based on generated temp file
		const { MAPPING: tempMapping } = await import('./element-parent-mapping.temp.js')
		MAPPING = tempMapping
		console.error('[definition] Using temp mapping for test fixtures')
	} catch {
		try {
			await access(regularMappingPath)
			const { MAPPING: regularMapping } = await import('./element-parent-mapping.js')
			MAPPING = regularMapping
			console.error('[definition] Using regular mapping')
		} catch {
			console.error('[definition] No mapping found, using empty mapping')
			MAPPING = {}
		}
	}

	// Read and parse schema
	const raw = await readFile(sourcePath, 'utf-8')
	const canonical: SchemaModel = JSON.parse(raw)
	const model = buildModel(canonical)

	// Generate both files
	const typesSource = emitTypes(model)
	const constantsSource = emitConstants(model)

	// Fix import paths (relative)
	const typesRelativePath = `./${typesBaseName}`
	const constantsRelativePath = `./${constantsBaseName}`

	const typesFinal = typesSource.replace('CONSTANTS_IMPORT_PATH', constantsRelativePath)
	const constantsFinal = constantsSource.replace('TYPES_IMPORT_PATH', typesRelativePath)

	// Generate descendants-ancestors file
	const descendantsAncestorsSource = emitDescendantsAncestors(
		model.elementNames,
		model.childElements,
		model.parentElements,
	)

	// Write all three files
	await mkdir(outDir, { recursive: true })
	await writeFile(typesPath, typesFinal, 'utf-8')
	await writeFile(constantsPath, constantsFinal, 'utf-8')

	const descendantsAncestorsPath = resolve(outDir, 'descendants-ancestors.generated.ts')
	await writeFile(descendantsAncestorsPath, descendantsAncestorsSource, 'utf-8')

	console.error(`[definition-types] Wrote ${typesPath}`)
	console.error(`[definition-constants] Wrote ${constantsPath}`)
	console.error(`[definition-descendants-ancestors] Wrote ${descendantsAncestorsPath}`)
}

// ESM-compatible direct invocation detection
const isDirectRun = (() => {
	// When executed via: node --import=tsx generate-schema-types.ts
	// import.meta.url will be the file URL; process.argv[1] is the path passed.
	try {
		const pathFromArgv = process.argv[1] && new URL('file://' + resolve(process.argv[1])).href
		return pathFromArgv === import.meta.url
	} catch {
		return false
	}
})()

if (isDirectRun) {
	main().catch((error: unknown) => {
		console.error(error)
		process.exit(1)
	})
}
