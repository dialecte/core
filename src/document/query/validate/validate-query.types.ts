import type { RefOrRecord } from '@/document/types.ref'
import type { AnyDialecteConfig, AttributesOf, ChildrenOf, ElementsOf, Namespace } from '@/types'

/**
 * A value about to be written: to `attribute` of a `tagName` child under `parent` (the child need not exist), or,
 * without `attribute`, to its text.
 */
export type ValidateFormValueParams<
	GenericConfig extends AnyDialecteConfig,
	GenericParent extends ElementsOf<GenericConfig>,
	GenericChild extends ChildrenOf<GenericConfig, GenericParent>,
> = {
	parent: RefOrRecord<GenericConfig, GenericParent>
	tagName: GenericChild
	/** The type the child names (or will name) with xsi:type, as stored: the attributes are read from that type. */
	xsiType?: string
	/**
	 * The attribute in one of the write path's two forms: a value-object key (the typed, possibly prefixed name an
	 * attribute is stored by: `ext:cA`, `xsi:type`), or the full-object form `{ name, namespace }` with a local name
	 * and a `Namespace` or a config key.
	 */
	attribute?:
		| AttributesOf<GenericConfig, GenericChild, GenericParent>
		| { name: string; namespace: Namespace | string }
	value: string
}
