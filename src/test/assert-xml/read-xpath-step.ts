import type { XpathStepReading } from './assert-xml.types'

/**
 * Reads one location step of an XPath as `splitXpathIntoSteps` cuts it (`/default:A[@aA="1"]`,
 * `//ext:B`, `/following-sibling::default:C[2]`): the step without its predicates, its axis, its name
 * test and the attributes its predicates name. Quotes and nested brackets are respected.
 */
export function readXpathStep(step: string): XpathStepReading {
	const { withoutPredicates, predicates } = splitPredicates(step)
	const separator = /^\/\/?/.exec(withoutPredicates)?.[0] ?? ''
	const afterSeparator = withoutPredicates.slice(separator.length)
	const axisMatch = /^([a-z-]+)::/.exec(afterSeparator)
	const nameTest = axisMatch ? afterSeparator.slice(axisMatch[0].length) : afterSeparator
	return {
		withoutPredicates,
		separator,
		axis: axisMatch?.[1],
		name: readQualifiedName(nameTest),
		predicateAttributes: readPredicateAttributes(predicates),
	}
}

/** The step's text outside its top-level `[...]`, and the text inside them. */
function splitPredicates(step: string): { withoutPredicates: string; predicates: string } {
	let withoutPredicates = ''
	let predicates = ''
	let depth = 0
	let quote: string | undefined
	for (const character of step) {
		if (quote) {
			if (character === quote) quote = undefined
		} else if (character === '"' || character === "'") {
			quote = character
		} else if (character === '[') {
			depth += 1
			if (depth === 1) continue
		} else if (character === ']') {
			depth -= 1
			if (depth === 0) {
				predicates += ' '
				continue
			}
		}
		if (depth > 0) predicates += character
		else withoutPredicates += character
	}
	return { withoutPredicates, predicates }
}

function readQualifiedName(nameTest: string): XpathStepReading['name'] {
	const match = /^(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)$/.exec(nameTest)
	if (!match) return undefined
	return { prefix: match[1], localName: match[2] }
}

/** The `@name` and `@prefix:name` the predicates hold, string literals left out, each once. */
function readPredicateAttributes(predicates: string): string[] {
	const withoutLiterals = predicates.replace(/'[^']*'|"[^"]*"/g, '')
	const names = [...withoutLiterals.matchAll(/@([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)/g)].map(
		(match) => match[1],
	)
	return [...new Set(names)]
}
