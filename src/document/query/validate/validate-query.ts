import { getRecord } from '../get/record'

import { toRef } from '@/helpers'
import { invariant } from '@/utils/invariant'
import { formValueTarget, validateFormValue } from '@/validation'

import type { Context } from '../../types'
import type { ValidateFormValueParams } from './validate-query.types'
import type { AnyDialecteConfig, ChildrenOf, ElementsOf } from '@/types'
import type { ValueIssue } from '@/validation'

/**
 * The validation namespace: what the schema says of values and records, computed on the state the query sees (a
 * transaction's staged writes included). Nothing is stored.
 *
 * Accessible via `query.validate.*` or `transaction.validate.*`.
 */
export class ValidateQuery<GenericConfig extends AnyDialecteConfig> {
	constructor(
		protected getContext: () => Context<GenericConfig>,
		protected dialecteConfig: GenericConfig,
	) {}

	/**
	 * Whether a value may be written to an attribute (or, without `attribute`, the text) of a child, as the child
	 * is declared under `parent` - before it exists. Reads the parent once, nothing else: every prefix resolves
	 * through the dialecte's namespaces (`xs` for XSD, `xml:` always bound; a Clark name `{uri}local` as itself), as
	 * the write path reads it: a QName value whose prefix the dialecte does not declare is refused (`datatype`).
	 * `attribute` takes the write path's two forms: a value-object key or `{ name, namespace }`.
	 *
	 * @returns The `ValueIssue` that refuses the value, or `undefined` when it is admitted or not typed.
	 * @throws `ELEMENT_NOT_FOUND` when the parent is not found, `INVALID_PARENT_CHILD` when it cannot hold the
	 *   child, the write path's keys for an attribute input it refuses (`UNKNOWN_NAMESPACE_PREFIX` for a key prefix
	 *   or namespace key the dialecte does not declare, `PREFIXED_ATTRIBUTE_NAME` for a prefixed name in the object
	 *   form), `INVALID_ATTRIBUTE` when the child declares no such attribute and no wildcard admits it.
	 *
	 * @intent check a form value before writing it, validate an attribute or text value against the schema, why is this value refused
	 *
	 * @example
	 * ```ts
	 * const issue = await query.validate.value({ parent: a, tagName: 'AA_2', attribute: 'aAA_2', value: '150' })
	 * // { reason: 'range', actual: '150', expected: '100', facet: 'maxInclusive' }
	 * ```
	 */
	async value<
		GenericParent extends ElementsOf<GenericConfig>,
		GenericChild extends ChildrenOf<GenericConfig, GenericParent>,
	>(
		params: ValidateFormValueParams<GenericConfig, GenericParent, GenericChild>,
	): Promise<ValueIssue | undefined> {
		const { tagName, xsiType, attribute, value } = params
		const context = this.getContext()
		const dialecteConfig = this.dialecteConfig
		const ref = toRef(params.parent)
		const parent = await getRecord({ context, ref })
		invariant(parent, {
			key: 'ELEMENT_NOT_FOUND',
			detail: `validate.value: parent '${ref.tagName}' not found`,
			ref,
		})
		const target = formValueTarget({ dialecteConfig, parent, tagName, xsiType, attribute })
		return validateFormValue({ dialecteConfig, target, value })
	}
}
