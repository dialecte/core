import type { AnyDialecteConfig, ElementsOf, RawRecord, TrackedRecord, TreeRecord } from '@/types'

/**
 * Returns a new record with specified attribute names removed.
 * Pure function — does not mutate the input.
 */
export function stripAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record: TreeRecord<GenericConfig, GenericElement>,
	names: string[],
): TreeRecord<GenericConfig, GenericElement>

export function stripAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record: TrackedRecord<GenericConfig, GenericElement>,
	names: string[],
): TrackedRecord<GenericConfig, GenericElement>

export function stripAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record: RawRecord<GenericConfig, GenericElement>,
	names: string[],
): RawRecord<GenericConfig, GenericElement>

export function stripAttributes<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(
	record:
		| RawRecord<GenericConfig, GenericElement>
		| TrackedRecord<GenericConfig, GenericElement>
		| TreeRecord<GenericConfig, GenericElement>,
	names: string[],
):
	| RawRecord<GenericConfig, GenericElement>
	| TrackedRecord<GenericConfig, GenericElement>
	| TreeRecord<GenericConfig, GenericElement> {
	const nameSet = new Set(names)
	const stripped = { ...record, attributes: record.attributes.filter((a) => !nameSet.has(a.name)) }

	if ('tree' in record) {
		return {
			...stripped,
			tree: record.tree.map((child) => stripAttributes(child, names)),
		} as TreeRecord<GenericConfig, GenericElement>
	}

	return stripped
}
