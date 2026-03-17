import type { ExtensionModules, MergedExtensions } from '@/types/extensions'

/**
 * Merges named extension modules into the flat { query, transaction } registry
 * expected by openDialecteDocument.
 *
 * @example
 * ```ts
 * export const EXTENSIONS = mergeExtensions({ History, IED })
 * // → { query: { History: ..., IED: ... }, transaction: { History: ..., IED: ... } }
 * ```
 */
export function mergeExtensions<Modules extends ExtensionModules>(
	modules: Modules,
): MergedExtensions<Modules> {
	const query: Record<string, unknown> = {}
	const transaction: Record<string, unknown> = {}

	for (const [key, mod] of Object.entries(modules)) {
		if (mod.query) query[key] = mod.query
		if (mod.transaction) transaction[key] = mod.transaction
	}

	return { query, transaction } as MergedExtensions<Modules>
}
