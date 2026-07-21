import type { Namespace } from '@/types'

/**
 * Schema-derived facts about a single attribute of an element.
 *
 * Single source of truth shared by `standardizeRecord` (which builds the
 * canonical stored form) and export's `shouldSkipDefaultAttribute` (which
 * shapes output). Centralizing the schema reads here keeps the two paths from
 * silently drifting apart — the analog of `orderByConfigSequence` for the
 * "which attributes belong, in what shape" question.
 */
export type AttributeRules = {
	/** The tag is a known dialecte element with a definition. */
	isKnownElement: boolean
	/** The attribute is declared in the element's schema. */
	isDefined: boolean
	/** The attribute is required by the schema. */
	isRequired: boolean
	/** The attribute is part of the element's identity (key/unique) fields. */
	isIdentityField: boolean
	/** Schema fixed value, if any (takes precedence over default). */
	fixed: string | undefined
	/** Schema default value, if any. */
	default: string | undefined
	/** Schema-declared namespace for the attribute, if any. */
	namespace: Namespace | undefined
}

/**
 * How absent attributes are resolved against the schema when reading or serializing.
 * The single knob shared by every read function and by export:
 *   - `'none'`     — faithful: inject nothing (stored-only).
 *   - `'optional'` — read view: `fixed`, else a **non-empty** `default` (skips a
 *     `required`-without-default attr and empty-string defaults).
 *   - `'required'` — XSD/export view: for a `required` **or** `fixed` attribute,
 *     `fixed ?? default ?? ''`; nothing for optional-only defaults.
 *
 * These are two category-targeted views, not a cumulative scale: `optional` fills
 * available defaults + fixed but never fabricates an empty required attr, and
 * `required` fills required + fixed but not optional defaults.
 */
export type AttributeDefaults = 'none' | 'optional' | 'required'
