import type { DataType, DeclarationDefinition, Facets, Namespace } from '@/types'
import type { DefinitionConfig, ResolvableRecord } from '@/utils/resolve-definition.types'
import type { NamespaceLookup } from '@/utils/xsi-type.types'

/** Why a value is refused: the step of the check that refused it. */
export type ValueIssueReason =
	| 'datatype'
	| 'enumeration'
	| 'pattern'
	| 'length'
	| 'range'
	| 'digits'

/**
 * Why a simple value is refused, as plain data: `actual` is the value after whitespace normalization (the item, for
 * an item of a list), `expected` what the refusing step wanted - the built-in name, the admitted values, the
 * pattern sources of the level that refused it, the facet value - and `facet` the facet that refused it.
 */
export type ValueIssue = {
	readonly reason: ValueIssueReason
	readonly actual: string
	readonly expected?: string | number | readonly string[]
	readonly facet?: keyof Facets
}

/** How whitespace in a value is read before it is checked. */
export type WhiteSpace = NonNullable<Facets['whiteSpace']>

export type ValidateValueParams = {
	readonly value: string
	readonly type: DataType
	/** How a QName-typed value's prefixes resolve; without one only the `xml` prefix is bound. */
	readonly namespaces?: NamespaceLookup
}

/** The parent a value is checked under, as read: its tag, its parent, its attributes and id. */
export type FormValueParent = ResolvableRecord & { readonly id: string }

/** Where a value is about to be written: an attribute (or, without one, the text) of a child under a parent. */
export type FormValueParams = {
	readonly dialecteConfig: DefinitionConfig
	readonly parent: FormValueParent
	readonly tagName: string
	/** The type the child names with xsi:type, as stored: its attributes are those of that type. */
	readonly xsiType?: string
	readonly attribute?: FormValueAttribute
}

/**
 * The attribute a value is written to, in the write path's two forms: a value-object key (`ext:cA`, `xsi:type`,
 * `xml:lang`), or the full-object form `{ name, namespace }` with a `Namespace` used as given or a config key.
 */
export type FormValueAttribute =
	| string
	| { readonly name: string; readonly namespace: Namespace | string }

/**
 * What a value written under a parent is judged as: the datatype of the attribute (or the text), the type the child
 * names with `xsi:type`, or nothing - a plain string, untyped text, a wildcard attribute, another `xsi:` attribute.
 */
export type FormValueTarget =
	| { readonly kind: 'datatype'; readonly type: DataType }
	| {
			readonly kind: 'xsiType'
			/** The child as declared under the parent, before it exists. */
			readonly child: ResolvableRecord
			readonly parentDefinition: DeclarationDefinition | undefined
	  }
	| { readonly kind: 'unjudged' }
	/** Refused before the value is read: the type the child names with xsi:type is bound nowhere. */
	| { readonly kind: 'refused'; readonly issue: ValueIssue }

// --- Value space (internal) ---

/** A decimal as `unscaled × 10^-scale`, its fraction stripped of trailing zeros (`scale` minimal, never negative). */
export type Decimal = {
	readonly unscaled: bigint
	readonly scale: number
}

/** A value read in its built-in's value space: what enumeration and the range facets compare. */
export type AtomicValue =
	| { readonly kind: 'string'; readonly value: string }
	| { readonly kind: 'decimal'; readonly value: Decimal }
	| { readonly kind: 'boolean'; readonly value: boolean }
	/** A qualified name by its Clark name (`{uri}local`, bare `local` in no namespace). */
	| { readonly kind: 'qname'; readonly clark: string }
	| { readonly kind: 'float'; readonly value: number }
	/** A point of the time line in seconds, the offset applied when it has one (`zoned`); `primitive` its built-in. */
	| {
			readonly kind: 'dateTime'
			readonly primitive: string
			readonly seconds: Decimal
			readonly zoned: boolean
	  }
	| { readonly kind: 'duration'; readonly months: bigint; readonly seconds: Decimal }
	/** `canonical` is one spelling per octet sequence: equal octets, equal spellings. */
	| { readonly kind: 'binary'; readonly octets: number; readonly canonical: string }

/** A value of a list: its items' values. */
export type ListValue = { readonly kind: 'list'; readonly items: readonly AtomicValue[] }

/** A value as its datatype reads it. */
export type SimpleValue = AtomicValue | ListValue

/**
 * What reading a lexical form against a built-in gives: its value, or nothing when the built-in refuses it. A
 * With `clarkNames`, a qualified name may also be its Clark name `{uri}local`: a facet value as the definition writes
 * it, a value in the form core stores (`{}local` in no namespace).
 */
export type ParseAtomic = (params: ParseAtomicParams) => AtomicValue | undefined

/** What a built-in reads: the lexical form (whitespace already normalized), the prefixes in scope, its origin. */
export type ParseAtomicParams = {
	lexical: string
	namespaces: NamespaceLookup
	clarkNames: boolean
}

/** What checking a value against a datatype gives: why it is refused, or its normalized form and its value. */
export type CheckedValue =
	| { readonly issue: ValueIssue }
	| { readonly issue?: undefined; readonly actual: string; readonly value: SimpleValue }

/** The facets that bound a value. */
export type RangeFacet = 'minInclusive' | 'minExclusive' | 'maxInclusive' | 'maxExclusive'

/** The order of two values: `indeterminate` where the value space leaves it open, `incomparable` where it has none. */
export type ValueOrder = -1 | 0 | 1 | 'indeterminate' | 'incomparable'

/** An atomic built-in: how its values are read. */
export type AtomicBuiltin = {
	readonly whiteSpace: WhiteSpace
	readonly parse: ParseAtomic
}

/** An inclusive range of Unicode code points. */
export type CodePointRange = readonly [number, number]

/** The parts of a date / time lexical form a calendar built-in names, as matched (absent where it names none). */
export type CalendarParts = {
	readonly year?: string
	readonly month?: string
	readonly day?: string
	readonly hour?: string
	readonly minute?: string
	readonly second?: string
	readonly zone?: string
}

/** What a facet check reads: the normalized value, its value, the datatype and its facets, how facet values read. */
export type FacetCheck = {
	readonly actual: string
	readonly value: SimpleValue
	readonly type: DataType
	readonly facets: Facets
	readonly literalValue: (literal: string) => SimpleValue | undefined
}
