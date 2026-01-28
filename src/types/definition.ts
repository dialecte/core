// Definition types for element metadata from XSD
// These types represent the raw JSON structure generated from XSD files

import type { Namespace } from './records'

/**
 * Validation rules that can be applied to attributes, elements, or values
 */
export type ValidationRules = {
	readonly enumeration: readonly string[] | null
	readonly pattern: readonly string[] | null
	readonly minInclusive: number | string | null
	readonly maxInclusive: number | string | null
	readonly minLength: number | string | null
	readonly maxLength: number | string | null
	readonly fractionDigits: number | string | null
	readonly totalDigits: number | string | null
	readonly whitespace: 'preserve' | 'replace' | 'collapse' | null
	readonly assertions: readonly any[] | null
	readonly minOccurrence: number | string | null
	readonly maxOccurrence: number | string | null
}

/**
 * Attribute definition with validation rules
 */
export type AttributeDefinition = {
	readonly required: boolean
	readonly default: string | null
	readonly namespace: Namespace | null
	readonly validation: ValidationRules
}

/**
 * Sub-element definition with constraints
 */
export type SubElementDefinition = {
	readonly required: boolean
	readonly validation: ValidationRules
	readonly constraints: readonly any[] | null
}

/**
 * Generic element definition parameterized by element type
 * Provides typed access to attributes, sub-elements, and parents
 */
export type ElementDefinition = {
	readonly tag: string
	readonly namespace: Namespace
	readonly documentation: string | null
	readonly parents: readonly string[]
	readonly validation: ValidationRules
	readonly attributes: {
		readonly any: boolean
		readonly sequence: readonly string[]
		readonly details: Record<string, AttributeDefinition>
	}
	readonly subElements: {
		readonly any: boolean
		readonly sequence: readonly string[]
		readonly details: Record<string, SubElementDefinition>
		readonly choices: readonly any[]
	}
	readonly constraints: readonly any[]
	readonly value: {
		readonly type: string | null
		readonly validation: ValidationRules
	}
}

/**
 * Complete definition - maps element names to their definitions
 * This is the raw JSON structure from XSD generation
 *
 * Each dialecte should define its own specific type extending this
 */
export type AnyDefinition = Record<string, ElementDefinition>
