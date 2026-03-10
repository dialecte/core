import type { AnyDefinition } from './definition'
import type { ImportOptions, ExportOptions, IOHooks } from './io'
import type { Operation } from './operations'
import type { Namespace, RawRecord, TreeRecord } from './records'
import type { Context } from '@/document'

export type RawDialecteConfig<
	GenericElementNames extends readonly string[],
	GenericRootElement extends GenericElementNames[number],
	GenericAttributes extends Record<string, any>,
	GenericChildren extends Record<string, readonly string[]>,
	GenericParents extends Record<string, readonly string[]>,
	GenericDescendants extends Record<string, readonly string[]>,
	GenericAncestors extends Record<string, readonly string[]>,
> = {
	rootElementName: GenericRootElement
	singletonElements?: readonly GenericElementNames[number][]
	namespaces: Record<'default', Namespace> & Record<string, Namespace>
	elements: GenericElementNames
	attributes: GenericAttributes
	children: GenericChildren
	parents: GenericParents
	descendants: GenericDescendants
	ancestors: GenericAncestors
	database: DatabaseConfig
	io: IOConfig
	definition: AnyDefinition
	hooks: TransactionHooks
}

export type IOConfig = {
	supportedFileExtensions: readonly string[]
	importOptions?: Partial<ImportOptions>
	exportOptions?: Partial<ExportOptions>
	hooks?: IOHooks
}

export type TransactionHooks = {
	/**
	 * Called before cloning a record.
	 * Return modified attributes for the clone.
	 */
	beforeClone?: <
		GenericConfig extends AnyDialecteConfig,
		GenericElement extends ElementsOf<GenericConfig>,
	>(params: {
		record: TreeRecord<GenericConfig, GenericElement>
	}) => { shouldBeCloned: boolean; transformedRecord: TreeRecord<GenericConfig, GenericElement> }

	/**
	 * Called after core standardizes element from definition.
	 * Use to enrich record (e.g., auto-generate UUIDs).
	 */
	afterStandardizedRecord?: <
		GenericConfig extends AnyDialecteConfig,
		GenericElement extends ElementsOf<GenericConfig>,
	>(params: {
		record: RawRecord<GenericConfig, GenericElement>
	}) => RawRecord<GenericConfig, GenericElement>

	/**
	 * Called after record created but before staging.
	 * Return additional operations (e.g., wrapper elements).
	 */
	afterCreated?: <
		GenericConfig extends AnyDialecteConfig,
		GenericElement extends ElementsOf<GenericConfig>,
		GenericParentElement extends ParentsOf<GenericConfig, GenericElement>,
	>(params: {
		childRecord: RawRecord<GenericConfig, GenericElement>
		parentRecord: RawRecord<GenericConfig, GenericParentElement>
		context: Context<GenericConfig>
	}) => Promise<Operation<GenericConfig>[]>
}

export type DatabaseConfig = Readonly<{
	tables: {
		xmlElements: {
			name: string
			schema: string
		}
		additionalTables?: Record<string, { schema: string }>
	}
}>

/**
 * Generic FlavorConfig type for contexts where specific flavor is not known.
 * Use this instead of FlavorConfig<any, any, any, any, any>
 */
export type AnyDialecteConfig = RawDialecteConfig<
	readonly string[],
	string,
	Record<string, any>,
	Record<string, readonly string[]>,
	Record<string, readonly string[]>,
	Record<string, readonly string[]>,
	Record<string, readonly string[]>
>

/**
 * Extract the element union type from a dialecte config
 */
export type ElementsOf<GenericConfig extends AnyDialecteConfig> = GenericConfig['elements'][number]
export type AnyElement = string

/**
 * Get attributes type for a specific element from dialecte config
 */
export type AttributesValueObjectOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['attributes'][GenericElement]
export type AnyAttributesValueObject = Record<string, string>

/**
 * Get attribute name union for a specific element from dialecte config
 */
export type AttributesOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = keyof AttributesValueObjectOf<GenericConfig, GenericElement> & string
export type AnyAttributeName = string

/**
 * Get attribute object type for a specific element from dialecte config
 */
export type FullAttributeObjectOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	[K in AttributesOf<GenericConfig, GenericElement>]: {
		name: K
		value: AttributesValueObjectOf<GenericConfig, GenericElement>[K]
		namespace?: Namespace
	}
}[AttributesOf<GenericConfig, GenericElement>]

/**
 * Get valid children elements for a specific element from dialecte config
 */
export type ChildrenOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['children'][GenericElement][number]
export type AnyChildren = ChildrenOf<AnyDialecteConfig, AnyElement>

/**
 * Get valid parent elements for a specific element from dialecte config
 */
export type ParentsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['parents'][GenericElement][number]
export type AnyParent = ParentsOf<AnyDialecteConfig, AnyElement>

/**
 * Get descendants elements for a specific element from dialecte config
 */
export type DescendantsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['descendants'][GenericElement][number]
export type AnyDescendant = DescendantsOf<AnyDialecteConfig, AnyElement>
/**
 * Get ancestors elements for a specific element from dialecte config
 */
export type AncestorsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['ancestors'][GenericElement][number]
export type AnyAncestors = AncestorsOf<AnyDialecteConfig, AnyElement>

/**
 * Get the root element type from a dialecte config
 */
export type RootElementOf<GenericConfig extends AnyDialecteConfig> =
	GenericConfig['rootElementName']

/**
 * Get singleton elements from dialecte config.
 * Always includes the root element — a root is by definition a singleton.
 */
export type SingletonElementsOf<GenericConfig extends AnyDialecteConfig> =
	| GenericConfig['rootElementName']
	| (GenericConfig['singletonElements'] extends readonly (infer E)[] ? E : never)
