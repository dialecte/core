// Definition types for element metadata from XSD
// These types represent the data `@dialecte/create` writes in `definition.generated.ts`

import type { Namespace } from './records'

// --- Identity constraints ---

/** A name test of a selector or field step: absent name or namespace = any (`*`, `p:*`); `namespace: ''` = none. */
export type NameTest = {
	readonly name?: string
	readonly namespace?: string
}

/** One alternative of a selector: the steps from the element the constraint is declared on (`[]` = itself). */
export type SelectorPath = {
	readonly deep?: true
	readonly steps: readonly NameTest[]
}

/** One alternative of a field: the attribute it reads, or without one the text of the element its steps reach. */
export type FieldPath = SelectorPath & {
	readonly attribute?: NameTest
}

export type IdentityConstraint = {
	readonly kind: 'unique' | 'key' | 'keyref'
	readonly name: string
	readonly namespace: string
	/** The key or unique a keyref refers to. */
	readonly refer?: { readonly name: string; readonly namespace: string }
	readonly selector: readonly SelectorPath[]
	/** Each field is a union of paths. */
	readonly fields: readonly (readonly FieldPath[])[]
}

// --- Values ---

/** The facets a restriction adds; ranges as the schema writes them, patterns one list per level (JS sources, `u`). */
export type Facets = {
	readonly enumeration?: readonly string[]
	/** Every level must match, one pattern of a level is enough. */
	readonly pattern?: readonly (readonly string[])[]
	readonly length?: number
	readonly minLength?: number
	readonly maxLength?: number
	readonly minInclusive?: string
	readonly maxInclusive?: string
	readonly minExclusive?: string
	readonly maxExclusive?: string
	readonly totalDigits?: number
	readonly fractionDigits?: number
	readonly whiteSpace?: 'preserve' | 'replace' | 'collapse'
}

/** What a simple value is: an XSD built-in, a list of one, or a union of several. */
export type DataType =
	| { readonly builtin: string; readonly facets?: Facets }
	| { readonly list: DataType; readonly facets?: Facets }
	| { readonly union: readonly DataType[]; readonly facets?: Facets }

export type AttributeDefinition = {
	readonly required?: true
	readonly default?: string
	readonly fixed?: string
	readonly namespace?: Namespace
	/** Absent for a plain string. */
	readonly type?: DataType
}

export type TextContent = {
	/** Absent for untyped (mixed) text. */
	readonly type?: DataType
	readonly default?: string
	readonly fixed?: string
}

// --- Structure ---

/** A wildcard: the namespaces it admits (`''` = none), or those it excludes, and how what it admits is checked. */
export type Wildcard = {
	readonly namespace?: readonly string[]
	readonly notNamespace?: readonly string[]
	readonly processContents: 'strict' | 'lax' | 'skip'
}

/** One node of a content model as the schema wrote it. */
export type Particle =
	| {
			readonly kind: 'sequence' | 'choice' | 'all'
			readonly minOccurs?: number
			readonly maxOccurs?: number
			readonly particles: readonly Particle[]
	  }
	| {
			readonly kind: 'element'
			readonly name: string
			/** Absent when the element is in its holder's namespace. */
			readonly namespace?: string
			/** The declaration it holds, for a tag declared several ways. */
			readonly declaration?: string
			readonly minOccurs?: number
			readonly maxOccurs?: number
	  }
	| ({
			readonly kind: 'any'
			readonly minOccurs?: number
			readonly maxOccurs?: number
	  } & Wildcard)

/** A child declared several ways: per namespace it is held in, the declarations its particles hold. */
export type ChildDefinition = {
	readonly declarations: Readonly<Record<string, readonly string[]>>
}

/** What an element, one of its declarations or a type lets an element hold. */
export type ContentDefinition = {
	readonly attributes: {
		readonly sequence: readonly string[]
		readonly any?: Wildcard
		readonly details: Readonly<Record<string, AttributeDefinition>>
		readonly identityFields?: readonly string[]
	}
	readonly children: {
		/** Every element it may hold, its variants' included. */
		readonly sequence: readonly string[]
		readonly any?: true
		/** Only the children declared several ways. */
		readonly details: Readonly<Record<string, ChildDefinition>>
	}
	readonly contentModel?: Particle
	readonly textContent?: TextContent
}

/** One way a tag is declared, or the tag level of a tag declared one way. */
export type DeclarationDefinition = ContentDefinition & {
	readonly namespace: Namespace
	readonly documentation?: string
	readonly global?: true
	readonly nillable?: true
	readonly constraints?: readonly IdentityConstraint[]
	/** The types an instance may name with xsi:type instead (Clark names, keys of the dialecte's `TYPES`). */
	readonly variants?: readonly string[]
	/** The declared type is abstract: an instance must name a variant. */
	readonly abstractType?: true
}

// --- Element definition ---

/**
 * What an element is: its declaration when the schema declares the tag one way; otherwise the union of its
 * `declarations` (required, default, fixed, constraints, variants only where they all agree), each one under its
 * number. `resolveDefinition` returns the one that applies to a record.
 */
export type ElementDefinition = DeclarationDefinition & {
	readonly tag: string
	readonly parents: readonly string[]
	readonly declarations?: Readonly<Record<string, DeclarationDefinition>>
}

/** The definition that applies to one record: its declaration (and xsi:type), with what the tag says whatever it. */
export type ResolvedDefinition = Omit<ElementDefinition, 'declarations'>

/**
 * Complete definition — maps element names to their definitions.
 * Each dialecte should define its own specific type extending this.
 */
export type AnyDefinition = Record<string, ElementDefinition>

/** The types elements may take with xsi:type, by Clark name (`{uri}local`, bare `local` in no namespace). */
export type AnyTypes = Readonly<Record<string, ContentDefinition>>
