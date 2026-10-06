import type { ERROR_CATALOG } from './codes'

export type DialecteErrorKey = keyof typeof ERROR_CATALOG
export type DialecteErrorCode = (typeof ERROR_CATALOG)[DialecteErrorKey]['code']

/**
 * An error a dialecte declares beside the core catalogue: its own key, its own code and the
 * default message shown when the consumer has no wording of its own for that key.
 * Build a catalogue of them with `defineErrors`.
 */
export type DialecteErrorDefinition<GenericKey extends string = string> = {
	key: GenericKey
	code: string
	message: string
}

/** What a dialecte gives `defineErrors`: one entry per error, named by its key. */
export type DialecteErrorCatalogInput = Record<string, { code: string; message: string }>

/** What `defineErrors` returns: each entry of the catalogue with its property name as `key`. */
export type DialecteErrorDefinitions<GenericCatalog extends DialecteErrorCatalogInput> = {
	readonly [GenericKey in keyof GenericCatalog & string]: DialecteErrorDefinition<GenericKey> &
		GenericCatalog[GenericKey]
}

/**
 * The entries of a catalogue that take a key or a code of the core catalogue, each typed `never`:
 * `defineErrors` refuses them at the type-check, on the entry itself.
 */
export type CoreCatalogueCollisions<GenericCatalog extends DialecteErrorCatalogInput> = {
	[GenericKey in keyof GenericCatalog as GenericKey extends DialecteErrorKey
		? GenericKey
		: GenericCatalog[GenericKey]['code'] extends DialecteErrorCode
			? GenericKey
			: never]: never
}

/**
 * Structured error — serializable, worker-safe, UI-consumable.
 * Original Error goes in `cause` to preserve stack trace.
 */
export type DialecteError<GenericKey extends string = DialecteErrorKey | (string & {})> = {
	/** A code of the core catalogue, or the code of an error a dialecte declared. */
	code: DialecteErrorCode | (string & {})
	/**
	 * A key of the core catalogue, or the key of an error a dialecte declared. Narrowed to the keys
	 * of the core and of the catalogues named, by `isKnownDialecteError`.
	 */
	key: GenericKey
	message: string // UI-consumable default wording (toast) — a consumer may map `key` to its own
	detail: string // developer-consumable (console)
	method: string // which operation failed
	ref?: { tagName: string; id: string }
	/**
	 * What the error is about, as data: the consumer builds its own wording from it instead of
	 * reading it out of `detail`. Serializable values only.
	 */
	meta?: Record<string, unknown>
	cause?: Error
}

/** What is given with the key when a structured error is raised. */
export type ThrowDialecteErrorParams = {
	detail: string
	message?: string
	ref?: { tagName: string; id?: string }
	/** What the error is about, as serializable data. */
	meta?: Record<string, unknown>
	cause?: Error
}

/** The keys of the catalogues `isKnownDialecteError` is given, with the keys of the core. */
export type KnownDialecteErrorKey<
	GenericCatalogues extends readonly DialecteErrorDefinitions<DialecteErrorCatalogInput>[],
> = DialecteErrorKey | KeysOfCatalogue<GenericCatalogues[number]>

type KeysOfCatalogue<GenericCatalogue> = GenericCatalogue extends unknown
	? keyof GenericCatalogue & string
	: never
