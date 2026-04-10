import { assert } from '@/utils'

import type { ExtensionModules, MergedExtensions } from '@/types/extensions'

function assertNoGroupCollision(
	a: Record<string, unknown> | undefined,
	b: Record<string, unknown> | undefined,
	moduleKey: string,
	group: string,
): void {
	if (!a || !b) return
	const conflicts = Object.keys(b).filter((k) => k in a)
	assert(conflicts.length === 0, {
		key: 'EXTENSION_METHOD_COLLISION',
		detail: `Module "${moduleKey}" has conflicting ${group} method(s): ${conflicts.map((c) => `"${c}"`).join(', ')}`,
	})
}

/**
 * Merges named extension modules into the flat { query, transaction } registry
 * expected by openDialecteDocument.
 *
 * When two module sets share the same module key (e.g. base and custom both define
 * "history"), their query and transaction groups are merged at the method level.
 * A DialecteError is thrown immediately if any method name appears in both groups.
 *
 * @example
 * ```ts
 * mergeExtensions({ base: { history, dataModel }, custom: { myFeature } })
 * // → { query: { history: ..., dataModel: ..., myFeature: ... }, transaction: { ... } }
 * ```
 */
export function mergeExtensions<
	BaseModules extends ExtensionModules,
	CustomModules extends ExtensionModules = Record<never, never>,
>(modules: {
	base?: BaseModules
	custom?: CustomModules
}): MergedExtensions<BaseModules & CustomModules> {
	const query: Record<string, unknown> = {}
	const transaction: Record<string, unknown> = {}

	const allModules = [
		...Object.entries(modules.base ?? {}),
		...Object.entries(modules.custom ?? {}),
	]

	for (const [key, mod] of allModules) {
		if (mod.query) {
			assertNoGroupCollision(
				query[key] as Record<string, unknown> | undefined,
				mod.query,
				key,
				'query',
			)
			query[key] = { ...(query[key] as object | undefined), ...mod.query }
		}
		if (mod.transaction) {
			assertNoGroupCollision(
				transaction[key] as Record<string, unknown> | undefined,
				mod.transaction,
				key,
				'transaction',
			)
			transaction[key] = { ...(transaction[key] as object | undefined), ...mod.transaction }
		}
	}

	return { query, transaction } as MergedExtensions<BaseModules & CustomModules>
}
