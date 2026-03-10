// const fs = require('fs')
// const content = fs.readFileSync(
// 	'/Users/m.guerin/Documents/ELIA/Dialecte/scl/src/v2019C1/definition/definition.generated.ts',
// 	'utf8',
// )
// const jsContent = content.replace('export const DEFINITION =', 'module.exports.DEFINITION =')
// const tmpPath = '/tmp/_def_temp.js'
// fs.writeFileSync(tmpPath, jsContent)
// const { DEFINITION } = require(tmpPath)

// // Build parent -> child -> maxOccurrence map
// const parentChildMax = new Map() // parentTag -> Map<childTag, maxOccurrence>
// const childParents = new Map() // childTag -> Set<parentTag>

// for (const [elemName, elemDef] of Object.entries(DEFINITION)) {
// 	if (!elemDef.subElements || !elemDef.subElements.details) continue
// 	const childMap = new Map()
// 	for (const [childTag, childDef] of Object.entries(elemDef.subElements.details)) {
// 		const maxOcc = childDef.validation ? childDef.validation.maxOccurrence : null
// 		childMap.set(childTag, maxOcc)
// 		if (!childParents.has(childTag)) childParents.set(childTag, new Set())
// 		childParents.get(childTag).add(elemName)
// 	}
// 	parentChildMax.set(elemName, childMap)
// }

// // Recursively compute max global instances
// const cache = new Map()

// function maxGlobalInstances(tag) {
// 	if (cache.has(tag)) return cache.get(tag)
// 	// Prevent infinite loops
// 	cache.set(tag, Infinity)

// 	// Root element
// 	if (tag === 'SCL') {
// 		cache.set(tag, 1)
// 		return 1
// 	}

// 	const parents = childParents.get(tag)
// 	if (!parents || parents.size === 0) {
// 		// No parents found (standalone type, not reachable) — treat as non-singleton
// 		cache.set(tag, Infinity)
// 		return Infinity
// 	}

// 	let total = 0
// 	for (const parent of parents) {
// 		const parentMax = maxGlobalInstances(parent)
// 		const childMaxOcc = parentChildMax.get(parent)?.get(tag)
// 		// null means unbounded
// 		if (childMaxOcc === null || childMaxOcc === undefined) {
// 			cache.set(tag, Infinity)
// 			return Infinity
// 		}
// 		if (parentMax === Infinity) {
// 			cache.set(tag, Infinity)
// 			return Infinity
// 		}
// 		total += parentMax * childMaxOcc
// 	}

// 	cache.set(tag, total)
// 	return total
// }

// // Compute for all elements
// const allElements = Object.keys(DEFINITION)
// const globalSingletons = allElements.filter((tag) => maxGlobalInstances(tag) === 1).sort()

// process.stdout.write('=== True GLOBAL singletons (max 1 instance in entire document) ===\n')
// globalSingletons.forEach((s) => process.stdout.write('  ' + s + '\n'))
// process.stdout.write('\nTotal: ' + globalSingletons.length + '\n')
// process.exit(0)
