import type { Namespace } from '@/types'

export type CLIArgs = { in: string; out: string }

// constraint definition (xs:unique / xs:key / xs:keyref)
export type Constraint = {
	name: string
	kind: 'unique' | 'key' | 'keyref'
	paths: string[][] // selector + field paths flattened to arrays of components
	deep: boolean // selector used descendant (//) axis
	refer: string | null // referenced key (keyref only)
	attributes: string[] // attribute names participating
	text: boolean // whether element text content participates
}

// Core validation facets (superset for attribute/element/child)
export type BaseValidationFacets = {
	enumeration: string[] | null
	pattern: string[] | null
	minInclusive: number | null
	maxInclusive: number | null
	//minExclusive: number | null
	//maxExclusive: number | null
	minLength: number | null
	maxLength: number | null
	fractionDigits: number | null
	totalDigits: number | null
	whitespace: string | null
	assertions: string[] | null
}

// Attribute & element simple-type style validation
export type AttributeValidation = BaseValidationFacets

// Child specific validation adds occurrence facets
export type ChildValidation = BaseValidationFacets & {
	minOccurrence: number | null
	maxOccurrence: number | null // null => unbounded
}

// Element level validation ( currently same facet structure )
export type ElementValidation = BaseValidationFacets & {
	minOccurrence: number | null
	maxOccurrence: number | null
}

export type AttributeDetail = {
	required: boolean
	default: string | null | undefined
	namespace: Namespace
	validation: AttributeValidation
}

export type SubElementDetail = {
	required: boolean
	validation: ChildValidation
	constraints: Constraint[] | null
}

export type ChoiceGroup = {
	minOccurrence: number | null
	maxOccurrence: number | null
	options: string[] // element names that form the choice
}

export type ElementDefinition = {
	tag: string
	namespace: Namespace
	documentation: string | null
	parents: string[]
	validation: ElementValidation
	attributes: {
		any: boolean
		sequence: string[] // ordered attribute names
		details: Record<string, AttributeDetail>
	}
	subElements: {
		any: boolean
		sequence: string[] // flat sequence including those in choices
		details: Record<string, SubElementDetail>
		choices: ChoiceGroup[]
	}
	constraints: Constraint[] // element-owned identity constraints
	value: string | null
}

export type SchemaModel = Record<string, ElementDefinition>

export type IntermediateAttributeEntry = {
	required: boolean
	enum: string[] | null
	pattern: string[] | null
}

export type IntermediateModel = {
	elementNames: string[]
	requiredAttributes: Record<string, string[]>
	attributeDetails: Record<string, Record<string, IntermediateAttributeEntry>>
	attributePatterns: Record<string, Record<string, string[]>>
	childElements: Record<string, string[]>
	parentElements: Record<string, string[]>
}
