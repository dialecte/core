/**
 * The levels of the language-server protocol: `error` and `warning` say something is wrong,
 * `information` reports what was done (a value rewritten on import), `hint` what could be better.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

/** What a diagnostic is about - the axis a reader filters by; a property of the catalogue entry, not of the diagnostic. */
export type DiagnosticFamily =
	| 'value'
	| 'attribute'
	| 'structure'
	| 'identity'
	| 'reference'
	| 'import'

/** The record a diagnostic points at, and the attribute when it is about one. */
export type DiagnosticRef = {
	tagName: string
	id: string
	attribute?: string
}

/**
 * Something a producer - an import hook, a validation rule - says about one record of a document.
 * The shape of the language-server protocol's `Diagnostic`, with `ref` where it has a text range
 * and `meta` where it has `data`. Plain data: it crosses a worker boundary as is.
 *
 * Its identity is the pair (`source`, `code`): two dialectes may both have an `unresolved-reference`.
 */
export type Diagnostic<GenericCode extends string = string> = {
	/** A code of the producer's catalogue. */
	code: GenericCode
	severity: DiagnosticSeverity
	/** Who said it: `'core'` for definition rules, the dialecte's name for its hooks and domain rules. */
	source: string
	/** Default wording; a consumer words it from `code` and `meta` and falls back to this. */
	message: string
	ref: DiagnosticRef
	/** The other records it involves - an incoherent reference names two elements. */
	related?: { ref: DiagnosticRef; message: string }[]
	/** What it is about, as serializable data - the contract, with `code`; `message` is the convenience. */
	meta?: Record<string, unknown>
}

/** What a catalogue says of one code: the severity its diagnostics carry, their family, their default wording. */
export type DiagnosticCatalogueEntry = {
	severity: DiagnosticSeverity
	family: DiagnosticFamily
	message: string
}

/**
 * The diagnostics a producer may emit, by code, under one `source`. A dialecte writes one per
 * concern (`SCL_IMPORT_DIAGNOSTICS`); a consumer narrows a diagnostic to its codes with
 * `isKnownDiagnostic`.
 */
export type DiagnosticCatalogue = {
	readonly source: string
	readonly codes: { readonly [GenericCode: string]: DiagnosticCatalogueEntry }
}

/** What `createDiagnostic` is given beside the code: the record, and what the diagnostic is about. */
export type CreateDiagnosticParams = {
	ref: DiagnosticRef
	/** A wording for this occurrence; the entry's default otherwise. */
	message?: string
	related?: Diagnostic['related']
	meta?: Record<string, unknown>
}

/**
 * What `createDiagnostic` returns: the diagnostic of that code, its `meta` and `related` typed as they
 * were given - so a dialecte's `Diagnostic<'x'> & { meta: {…} }` is what comes out, with no cast.
 */
export type CreatedDiagnostic<
	GenericCode extends string,
	GenericParams extends CreateDiagnosticParams,
> = Omit<Diagnostic<GenericCode>, 'meta' | 'related'> & Omit<GenericParams, 'ref' | 'message'>

/** The codes of the catalogues named, as `isKnownDiagnostic` narrows them. */
export type KnownDiagnosticCode<GenericCatalogues extends readonly DiagnosticCatalogue[]> =
	CodesOfCatalogue<GenericCatalogues[number]>

type CodesOfCatalogue<GenericCatalogue> = GenericCatalogue extends DiagnosticCatalogue
	? keyof GenericCatalogue['codes'] & string
	: never
