/**
 * Splits a full XPath expression into progressive evaluation steps
 * at `/` and `//` boundaries, respecting `[]`, `()`, and quoted strings.
 *
 * Each step is a prefix of the original XPath that is itself a valid XPath.
 * This enables progressive evaluation: if step N-1 matches but step N fails,
 * we can show the user exactly where the XPath diverged.
 *
 * Handles:
 * - `//` (descendant-or-self) and `/` (child) axes
 * - `[...]` predicates (including nested `[A[B]]` and paths inside `[@x="a/b"]`)
 * - `(...)` grouping
 * - Quoted strings with `/` inside (`@path="a/b/c"`)
 * - `|` union operator: a top-level union is not split (one step, the whole query); one inside `[]` or `()` is
 *   part of its step
 * - Leading `/` or `//` (absolute paths)
 * - Axis selectors like `following-sibling::` (not confused with `/`)
 */
export function splitXpathIntoSteps(xpath: string): string[] {
	const boundaries = findStepBoundaries(xpath)
	if (boundaries.length === 0) {
		return [xpath]
	}

	const steps: string[] = []
	for (const boundary of boundaries) {
		steps.push(xpath.slice(0, boundary))
	}
	steps.push(xpath)

	return steps
}

function findStepBoundaries(xpath: string): number[] {
	const boundaries: number[] = []
	let bracketDepth = 0
	let parenDepth = 0
	let quote: string | null = null

	for (let i = 0; i < xpath.length; i++) {
		const ch = xpath[i]

		if (quote) {
			if (ch === quote) {
				quote = null
			}
			continue
		}
		if (ch === '"' || ch === "'") {
			quote = ch
			continue
		}
		if (ch === '[') {
			bracketDepth++
			continue
		}
		if (ch === ']') {
			bracketDepth--
			continue
		}
		if (ch === '(') {
			parenDepth++
			continue
		}
		if (ch === ')') {
			parenDepth--
			continue
		}

		if (bracketDepth > 0 || parenDepth > 0) {
			continue
		}

		// a union at the top level is one expression: its branches have no common prefix to step through
		if (ch === '|') {
			return []
		}

		if (ch === '/') {
			// Skip leading / or //
			if (i === 0) {
				if (xpath[i + 1] === '/') {
					i++
				}
				continue
			}

			// Skip // that is the very start after trimming (defensive)
			if (boundaries.length === 0 && i === 1 && xpath[0] === '/') {
				continue
			}

			boundaries.push(i)

			// Skip the second / in //
			if (xpath[i + 1] === '/') {
				i++
			}
		}
	}

	return boundaries
}
