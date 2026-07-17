import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Namespace,
	AttributesValueObjectOf,
	DefaultAttributeNamesOf,
	DefaultAttributesValueObjectOf,
	LocalAttributeNamesInNamespace,
	NamespaceKeysUsedByElement,
} from '@/types'

/**
 * A single authored attribute in the full-object form. Namespaced attributes —
 * registered or not — are all authored the same way: a **local** `name` plus a
 * `namespace`, and dialecte derives the stored `prefix:local` key. The `namespace`
 * is either a registered namespace **key** (e.g. `'ext'`, which also scopes `name`
 * IntelliSense to that namespace's local attributes) or a full `{ prefix, uri }`
 * object for custom/foreign namespaces. Omit `namespace` for default-namespace
 * (standard) attributes. A prefixed `name` is rejected at runtime
 * (see `assertAuthoredAttributeNamesAreLocal`).
 */
export type AuthoredAttributeObjectOf<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	| {
			name: DefaultAttributeNamesOf<GenericConfig, GenericChildElement> | (string & {})
			value: string
			namespace?: undefined
	  }
	| {
			[GenericNamespaceKey in NamespaceKeysUsedByElement<GenericConfig, GenericChildElement>]: {
				name:
					| LocalAttributeNamesInNamespace<GenericConfig, GenericChildElement, GenericNamespaceKey>
					| (string & {})
				value: string
				namespace: GenericNamespaceKey
			}
	  }[NamespaceKeysUsedByElement<GenericConfig, GenericChildElement>]
	| {
			name: string
			value: string
			namespace: Namespace
	  }

/**
 * Attributes accepted by `addChild`. The less-verbose value-object form is reserved
 * for **default-namespace (standard) attributes**; any namespaced attribute is
 * authored via the full-object array form (see `AuthoredAttributeObjectOf`).
 */
export type ChildAttributesOf<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	| DefaultAttributesValueObjectOf<GenericConfig, GenericChildElement>
	| AuthoredAttributeObjectOf<GenericConfig, GenericChildElement>[]

/**
 * `attributes` is optional when the child element has no required attributes
 * and required as soon as it declares at least one required attribute.
 */
type AddChildAttributesParams<
	GenericConfig extends AnyDialecteConfig,
	GenericChildElement extends ElementsOf<GenericConfig>,
> =
	{} extends AttributesValueObjectOf<GenericConfig, GenericChildElement>
		? { attributes?: ChildAttributesOf<GenericConfig, GenericChildElement> }
		: { attributes: ChildAttributesOf<GenericConfig, GenericChildElement> }

export type AddChildParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
> = {
	id?: `${string}-${string}-${string}-${string}-${string}`
	tagName: GenericChildElement
	namespace?: Namespace
	value?: string
} & AddChildAttributesParams<GenericConfig, GenericChildElement>
