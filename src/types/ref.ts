import type { AnyDialecteConfig, ElementsOf, SingletonElementsOf } from './dialecte-config'
import type { DialecteRecord, ParentRelationship, ChildRelationship } from './records'

/**
 * A Ref is a typed pointer to a record in the document tree.
 * Lightweight, stable, can be stored, passed between functions, or compared.
 *
 * id is optional for singleton elements — the system resolves the record by tagName alone.
 * id is required for all other elements.
 *
 * Obtained by: addChild, deepClone, find, findChildren, findDescendants, getRoot
 */
export type Ref<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	GenericElement extends SingletonElementsOf<GenericConfig>
		? { readonly tagName: GenericElement; readonly id?: string }
		: { readonly tagName: GenericElement; readonly id: string }

export type AnyRef = { readonly tagName: string; readonly id?: string }

/**
 * Any value that can be resolved to a Ref: a typed ref, any record variant,
 * or a parent/child relationship. Includes undefined — toRef() will assert.
 *
 * Use this as the parameter type for public API methods so callers can pass
 * whatever "pointer" they naturally hold without casting.
 */
export type RefOrRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> =
	| Ref<GenericConfig, GenericElement>
	| DialecteRecord<GenericConfig, GenericElement>
	| ParentRelationship<GenericConfig, GenericElement>
	| ChildRelationship<GenericConfig, GenericElement>
