import type {
	AnyDialecteConfig,
	ElementsOf,
	AttributesOf,
	ParentsOf,
	ChildrenOf,
	DescendantsOf,
} from './dialecte-config'
import type { OperationStatus } from './operations'

export type Namespace = {
	prefix: string
	uri: string
}

export type AnyRelationship = {
	id: string
	tagName: string
}

export type ParentRelationship<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = Omit<AnyRelationship, 'tagName'> & {
	tagName: ParentsOf<GenericConfig, GenericElement>
}

export type ChildRelationship<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = Omit<AnyRelationship, 'tagName'> & {
	tagName: ChildrenOf<GenericConfig, GenericElement>
}

export type AnyAttribute = {
	name: string
	value: string
	namespace?: Namespace
}

export type Attribute<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = Omit<AnyAttribute, 'name' | 'namespace'> & {
	name: AttributesOf<GenericConfig, GenericElement>
}

export type AnyQualifiedAttribute = Omit<AnyAttribute, 'namespace'> & {
	namespace: Namespace
}

export type QualifiedAttribute<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = Omit<Attribute<GenericConfig, GenericElement>, 'namespace'> & {
	namespace: Namespace
}

//== Raw Record

export type RawRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	id: string
	tagName: GenericElement
	namespace: Namespace
	attributes: Array<
		Attribute<GenericConfig, GenericElement> | QualifiedAttribute<GenericConfig, GenericElement>
	>
	value: string
	parent: ParentRelationship<GenericConfig, GenericElement> | null
	children: ChildRelationship<GenericConfig, GenericElement>[]
}

export type AnyRawRecord = {
	id: string
	tagName: string
	namespace: Namespace
	attributes: AnyAttribute[]
	value: string
	parent: AnyRelationship | null
	children: AnyRelationship[]
}

//== Dialecte Record

export type ChainRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = RawRecord<GenericConfig, GenericElement> & {
	status: OperationStatus
}

export type AnyChainRecord<GenericConfig extends AnyDialecteConfig = AnyDialecteConfig> =
	ChainRecord<GenericConfig, ElementsOf<GenericConfig>>

//== Tree Record

export type TreeRecord<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = ChainRecord<GenericConfig, GenericElement> & {
	tree: TreeRecord<GenericConfig, ChildrenOf<GenericConfig, GenericElement>>[]
}
