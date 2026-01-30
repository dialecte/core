import type { Context } from './context'
import type { AnyDefinition } from './definition'
import type { ImportOptions, ExportOptions } from './io'
import type { Operation } from './operations'
import type { Namespace, ChainRecord, RawRecord, TreeRecord } from './records'
import type { ChainFactory } from '@/chain-methods'

export type RawDialecteConfig<
	GenericElementNames extends readonly string[],
	GenericRootElement extends GenericElementNames[number],
	GenericAttributes extends Record<string, any>,
	GenericChildren extends Record<string, readonly string[]>,
	GenericParents extends Record<string, readonly string[]>,
	GenericDescendants extends Record<string, readonly string[]>,
	GenericAncestors extends Record<string, readonly string[]>,
	GenericExtensions extends Record<
		GenericElementNames[number],
		Record<string, (...args: any[]) => any>
	>,
	//GenericDefinition extends AnyDefinition,
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
	// definition: GenericDefinition
	extensions: GenericExtensions
	hooks: DialecteHooks
}

export type IOConfig = {
	supportedFileExtensions: readonly string[]
	importOptions?: Partial<ImportOptions>
	exportOptions?: Partial<ExportOptions>
}

export type ExtensionsMethodParams<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	chain: ChainFactory
	dialecteConfig: RuntimeDialecteConfig<GenericConfig>
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
}

/**
 * Extension method creator - receives context params and returns the actual extension method
 * The returned method should be chainable (return a CoreChain) unless it's an ending method
 */
export type ExtensionMethodCreator<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = (params: ExtensionsMethodParams<GenericConfig, GenericElement>) => (...args: any[]) => any // Extension methods can take any args and return any (chain or data)

/**
 * Extension registry - maps element types to their extension methods
 * Each element can have multiple extension methods identified by method name
 */
export type ExtensionRegistry<GenericConfig extends AnyDialecteConfig> = Partial<{
	[K in ElementsOf<GenericConfig>]: Record<string, ExtensionMethodCreator<GenericConfig, K>>
}>

export type DialecteHooks = {
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
		context: Context<GenericConfig, GenericParentElement>
	}) => Operation<GenericConfig>[]
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

// export type DatabaseConfigWithInstance<GenericConfig extends AnyDialecteConfig> = DatabaseConfig & {
// 	instance: DatabaseInstance<GenericConfig>
// }

export type RuntimeDialecteConfig<GenericConfig extends AnyDialecteConfig> = GenericConfig & {
	//database: DatabaseConfigWithInstance<GenericConfig>
	extensions: ExtensionRegistry<GenericConfig>
}

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
	Record<string, readonly string[]>,
	Record<string, Record<string, (...args: any[]) => any>>
>

/**
 * Extract the element union type from a dialecte config
 */
export type ElementsOf<GenericConfig extends AnyDialecteConfig> = GenericConfig['elements'][number]
export type AnyElement = string

/**
 * Get attributes type for a specific element from dialecte config
 */
//TODO: old type name AttributesOf
export type AttributesValueObjectOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['attributes'][GenericElement]
export type AnyAttributesValueObject = Record<string, string>

/**
 * Get attribute name union for a specific element from dialecte config
 */
//TODO: old type name AvailableAttribute
export type AttributesOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = keyof AttributesValueObjectOf<GenericConfig, GenericElement> & string
export type AnyAttributeName = string

/**
 * Get attribute object type for a specific element from dialecte config
 */
//TODO: old type name AvailableAttributeObject
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

/**
 * Get valid parent elements for a specific element from dialecte config
 */
export type ParentsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['parents'][GenericElement][number]

/**
 * Get descendants elements for a specific element from dialecte config
 */
export type DescendantsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['descendants'][GenericElement][number]

/**
 * Get ancestors elements for a specific element from dialecte config
 */
export type AncestorsOf<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = GenericConfig['ancestors'][GenericElement][number]

/**
 * Get the root element type from a dialecte config
 */
export type RootElementOf<GenericConfig extends AnyDialecteConfig> =
	GenericConfig['rootElementName']

/**
 * Get singleton elements from dialecte config
 */
export type SingletonElementsOf<GenericConfig extends AnyDialecteConfig> =
	GenericConfig['singletonElements'] extends readonly (infer E)[] ? E : never
