import { DIALECTE_NAMESPACES } from '../constant'

import type { ElementDefinition } from '@/types'

const NULL_VALIDATION = {
	enumeration: null,
	pattern: null,
	minInclusive: null,
	maxInclusive: null,
	minLength: null,
	maxLength: null,
	totalDigits: null,
	fractionDigits: null,
	whitespace: null,
	minOccurrence: null,
	maxOccurrence: null,
	assertions: null,
}

type AttributeConfig = { required: string[]; optional: string[] }

// Rule of 3: A, B, C branches × 3 levels × 3 siblings = clean structure
// Element names: A → A_1, A_2, A_3 → AA_1, AA_2, AA_3 → AAA_1, AAA_2, AAA_3
// Attributes: lowercase a, b, c with element suffix (e.g., BBB_1 → aBBB_1, bBBB_1, cBBB_1)
// Namespace: _3 elements and c attributes use ext namespace
// Required: a attribute required, b and c optional
// Validation: _1 elements required (minOccurrence=1), maxOccurrence = element number
function getAttributesForPath(
	path: string,
	elementNamespace: typeof DIALECTE_NAMESPACES.default | typeof DIALECTE_NAMESPACES.ext,
): AttributeConfig {
	return {
		required: [`a${path}`],
		optional: [`b${path}`, `c${path}`],
	}
}

function generateTestDefinition() {
	const branches = ['A', 'B', 'C']
	const depth = 3 // 3 levels from each root branch

	const definition: Record<string, ElementDefinition> = {}

	// Generate Root
	definition.Root = {
		tag: 'Root',
		documentation: 'Root element for test fixture',
		parents: [],
		validation: NULL_VALIDATION,
		constraints: [],
		value: {
			type: 'string',
			validation: NULL_VALIDATION,
		},
		namespace: DIALECTE_NAMESPACES.default,
		attributes: {
			any: false,
			sequence: [],
			details: {},
		},
		subElements: {
			any: false,
			sequence: branches,
			details: Object.fromEntries(
				branches.map((b) => [
					b,
					{
						required: false,
						validation: NULL_VALIDATION,
						constraints: [],
					},
				]),
			),
			choices: [],
		},
	}

	// Generate all elements for each branch
	for (const branch of branches) {
		generateBranch(branch, depth, definition)
	}

	return definition
}

function generateBranch(
	branchName: string,
	depth: number,
	definition: Record<string, ElementDefinition>,
) {
	const paths = generatePaths(branchName, depth)

	for (const path of paths) {
		const level = getLevel(path)
		const parent = getParent(path)
		const children = getChildren(path, depth)

		// Namespace rule: _3 elements use ext namespace
		const endsWithThree = path.endsWith('_3')
		const ns = endsWithThree ? DIALECTE_NAMESPACES.ext : DIALECTE_NAMESPACES.default

		const attrConfig = getAttributesForPath(path, ns)
		const allAttrs = [...attrConfig.required, ...attrConfig.optional]

		// Validation rules for element occurrence
		const elementNumber = getElementNumber(path) // _1 = 1, _2 = 2, _3 = 3
		const isRequired = elementNumber === 1
		const validation = {
			...NULL_VALIDATION,
			minOccurrence: isRequired ? 1 : null,
			maxOccurrence: elementNumber,
		}

		definition[path] = {
			tag: path,
			documentation: `${path} element - level ${level}${children.length === 0 ? ' (leaf)' : ''}`,
			parents: parent ? [parent] : ['Root'],
			validation,
			constraints: [],
			value: {
				type: 'string',
				validation: NULL_VALIDATION,
			},
			namespace: ns,
			attributes: {
				any: false,
				sequence: allAttrs,
				details: Object.fromEntries(
					allAttrs.map((attr) => {
						const isRequired = attrConfig.required.includes(attr)
						// c attribute always uses ext namespace
						const isCAttr = attr.startsWith('c')
						const attrNs = isCAttr ? DIALECTE_NAMESPACES.ext : ns
						return [
							attr,
							{
								namespace: attrNs,
								required: isRequired,
								default: null,
								validation: NULL_VALIDATION,
							},
						]
					}),
				),
			},
			subElements: {
				any: false,
				sequence: children,
				details: Object.fromEntries(
					children.map((child) => {
						const childNumber = getElementNumber(child)
						const childRequired = childNumber === 1
						return [
							child,
							{
								required: childRequired,
								validation: {
									...NULL_VALIDATION,
									minOccurrence: childRequired ? 1 : null,
									maxOccurrence: childNumber,
								},
								constraints: [],
							},
						]
					}),
				),
				choices: [],
			},
		}
	}
}

function generatePaths(branch: string, depth: number): string[] {
	const paths: string[] = [branch]

	// Generate 3 children per node: _1, _2, _3
	let currentLevel = [branch]

	for (let level = 1; level <= depth; level++) {
		const nextLevel: string[] = []
		for (const parent of currentLevel) {
			// Add one letter to the prefix for each level
			const prefix = parent.replace(/_\d+/g, '') + branch.charAt(0)
			for (let i = 1; i <= 3; i++) {
				const child = `${prefix}_${i}`
				paths.push(child)
				nextLevel.push(child)
			}
		}
		currentLevel = nextLevel
	}

	return paths
}

function getParent(path: string): string | null {
	// A → null
	// AA_1 → A
	// AAA_1 → AA_1
	// AAAA_2 → AAA_2
	if (path.length === 1) return null // Root level (A, B, C)

	const match = path.match(/^([A-Z]+)_(\d+)$/)
	if (!match) return null

	const [, letters, number] = match
	if (letters.length === 2) {
		// AA_1 → parent is A (remove one letter, no suffix)
		return letters.charAt(0)
	} else {
		// AAA_2 → parent is AA_2, AAAA_3 → parent is AAA_3
		return `${letters.slice(0, -1)}_${number}`
	}
}

function getChildren(path: string, maxDepth: number): string[] {
	const level = getLevel(path)
	if (level > maxDepth) return [] // Beyond max depth

	const match = path.match(/^([A-Z]+)(?:_(\d+))?$/)
	if (!match) return []

	const [, letters, number] = match
	const newPrefix = letters + letters.charAt(0)

	return [`${newPrefix}_1`, `${newPrefix}_2`, `${newPrefix}_3`]
}

function getLevel(path: string): number {
	// A, B, C = level 1
	// A_1, A_2, A_3 = level 2
	// AA_1, AA_2, AA_3 = level 3
	// AAA_1, AAA_2, AAA_3 = level 4
	const letters = path.replace(/_\d+/g, '')
	return letters.length
}

function getElementNumber(path: string): number {
	// Extract the number from _1, _2, _3, or default to 1 for root level elements (A, B, C)
	const match = path.match(/_(\d+)$/)
	return match ? parseInt(match[1], 10) : 1
}

export const DEFINITION = generateTestDefinition()
