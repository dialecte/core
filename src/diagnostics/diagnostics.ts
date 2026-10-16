import { throwDialecteError } from '@/errors'

import type {
	CreateDiagnosticParams,
	CreatedDiagnostic,
	Diagnostic,
	DiagnosticCatalogue,
	KnownDiagnosticCode,
} from './types'

/**
 * Build a diagnostic of a catalogue: `severity`, `source` and the default `message` come from the
 * entry, so a producer only says what the diagnostic is about. The `meta` and `related` given keep
 * their type on the way out, so a dialecte's typed diagnostic (`Diagnostic<'x'> & { meta: {…} }`) is
 * what this returns when it is given that `meta`.
 *
 * @example
 * createDiagnostic(SCL_IMPORT_DIAGNOSTICS, 'unresolved-reference', {
 *   ref: { tagName: 'FunctionRef', id, attribute: 'function' },
 *   meta: { pathValue, triedKeys },
 * })
 */
export function createDiagnostic<
	const GenericCatalogue extends DiagnosticCatalogue,
	GenericCode extends keyof GenericCatalogue['codes'] & string,
	GenericParams extends CreateDiagnosticParams,
>(
	catalogue: GenericCatalogue,
	code: GenericCode,
	params: GenericParams,
): CreatedDiagnostic<GenericCode, GenericParams> {
	const entry = catalogue.codes[code]
	if (!entry) {
		throwDialecteError('ASSERTION_FAILED', {
			detail: `createDiagnostic: "${code}" is not a code of the "${catalogue.source}" catalogue`,
		})
	}
	const { ref, message = entry.message, related, meta } = params
	return {
		code,
		severity: entry.severity,
		source: catalogue.source,
		message,
		ref,
		...(related && { related }),
		...(meta && { meta }),
	} as CreatedDiagnostic<GenericCode, GenericParams>
}

/**
 * Whether a diagnostic is one the caller knows: an entry of one of the catalogues named, matched on
 * the pair (`source`, `code`) - two dialectes may both have an `unresolved-reference`. Its `code` is
 * then narrowed to those catalogues' codes, so a `switch` on it or a table read with it is checked.
 *
 * @example
 * if (isKnownDiagnostic(diagnostic, { catalogues: [SCL_IMPORT_DIAGNOSTICS] })) sentences[diagnostic.code]
 */
export function isKnownDiagnostic<const GenericCatalogues extends readonly DiagnosticCatalogue[]>(
	diagnostic: Diagnostic,
	params: { catalogues: GenericCatalogues },
): diagnostic is Diagnostic<KnownDiagnosticCode<GenericCatalogues>> {
	return params.catalogues.some(
		(catalogue) =>
			catalogue.source === diagnostic.source && Object.hasOwn(catalogue.codes, diagnostic.code),
	)
}
