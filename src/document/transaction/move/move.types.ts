import type { Ref } from '@/document'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/**
 * An element of tag `GenericElement` as `tx.move` takes it: anything carrying its own tag and id - a ref, a record, a
 * record's `parent`, an entry of `children`. Unlike `RefOrRecord`, it names no element of another tag, so the tags are
 * read from what is passed.
 */
export type MovePointer<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = { readonly tagName: GenericElement; readonly id?: string }

/**
 * Where `tx.move` puts an element of tag `GenericElement`: under `parent`, right before `before` (a child of `parent`
 * with the element's tag) or, without `before`, after the last child of `parent` with that tag.
 */
export type MoveParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericParent extends ElementsOf<GenericConfig>,
> = {
	parent: MovePointer<GenericConfig, GenericParent>
	before?: MovePointer<GenericConfig, NoInfer<GenericElement>>
}

/** A ref of any tag of the dialecte, as the staging step takes it. */
export type AnyRefOf<GenericConfig extends AnyDialecteConfig> = Ref<
	GenericConfig,
	ElementsOf<GenericConfig>
>
