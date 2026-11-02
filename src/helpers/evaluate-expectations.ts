import type {
	EvaluateExpectationsParams,
	Expectation,
	ExpectationScope,
	ExpectationsOutcome,
} from './evaluate-expectations.types'
import type { Collect, Query } from '@/document'
import type { AnyDialecteConfig, AnyTrackedRecord, ElementsOf } from '@/types'

/**
 * Check what a document holds against expectations written before the script that builds it, with
 * no DOM: each expectation counts the elements of its tag (with its attribute values, under an
 * element of its `under` scope) through the query, so a prepared transaction's `query` is checked
 * on what `commit()` would write. Every expectation is answered, met or failed with the count found.
 *
 * @intent check a built document against expected element counts, verify a script's result before committing, test what a prepared transaction would write
 *
 * @example
 * ```ts
 * const { failed } = await evaluateExpectations(doc.query, {
 *   expectations: [{ tag: 'Part', under: { tag: 'Assembly', where: { name: 'A1' } }, count: 2 }],
 * })
 * // failed: [{ expectation, actualCount: 1, message: 'expected 2 Part under Assembly[name="A1"], found 1' }]
 * ```
 */
export async function evaluateExpectations<GenericConfig extends AnyDialecteConfig>(
	query: Query<GenericConfig>,
	params: EvaluateExpectationsParams,
): Promise<ExpectationsOutcome> {
	const outcome: ExpectationsOutcome = { passed: [], failed: [] }

	for (const expectation of params.expectations) {
		const actualCount = await countMatching(query, { expectation })
		if (isMet({ expectation, actualCount })) {
			outcome.passed.push(expectation)
			continue
		}
		outcome.failed.push({
			expectation,
			actualCount,
			message: describeFailure({ expectation, actualCount }),
		})
	}

	return outcome
}

/** The elements an expectation names, each counted once however many of its scopes hold it. */
async function countMatching<GenericConfig extends AnyDialecteConfig>(
	query: Query<GenericConfig>,
	params: { expectation: Expectation },
): Promise<number> {
	const { tag, where = {}, under } = params.expectation
	if (!under) {
		const matching = await query.any.findByAttributes({ tagName: tag, attributes: where })
		return matching.length
	}

	const scopes = await query.any.findByAttributes({
		tagName: under.tag,
		attributes: under.where ?? {},
	})
	const collect = [{ [tag]: { where } }] as unknown as Collect<
		GenericConfig,
		ElementsOf<GenericConfig>
	>
	const matchingIds = new Set<string>()
	for (const scope of scopes) {
		const groups = (await query.findDescendants(
			{ tagName: scope.tagName as ElementsOf<GenericConfig>, id: scope.id },
			{ collect },
		)) as Partial<Record<string, AnyTrackedRecord[]>>
		for (const record of groups[tag] ?? []) matchingIds.add(record.id)
	}
	return matchingIds.size
}

function isMet(params: { expectation: Expectation; actualCount: number }): boolean {
	const { expectation, actualCount } = params
	if (expectation.count === undefined) return actualCount > 0
	return actualCount === expectation.count
}

function describeFailure(params: { expectation: Expectation; actualCount: number }): string {
	const { expectation, actualCount } = params
	const wanted =
		expectation.count === undefined
			? 'at least one'
			: expectation.count === 0
				? 'no'
				: String(expectation.count)
	const scope = expectation.under ? ` under ${describeScope(expectation.under)}` : ''
	return `expected ${wanted} ${describeScope(expectation)}${scope}, found ${actualCount}`
}

/** `Tag` or `Tag[name="value"][kind="a"|"b"]`. */
function describeScope(scope: ExpectationScope): string {
	const filters = Object.entries(scope.where ?? {}).map(function describeFilter([name, value]) {
		const values = Array.isArray(value) ? value : [value]
		return `[${name}=${values.map((each) => `"${each}"`).join('|')}]`
	})
	return `${scope.tag}${filters.join('')}`
}
