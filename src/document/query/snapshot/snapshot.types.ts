import type { OmitEntry } from '../tree-filter'
import type { RefOrRecord } from '@/document'
import type { AnyDialecteConfig, AnyTrackedRecord, AnyTreeRecord, ElementsOf } from '@/types'

export type SnapshotFormat = 'tree' | 'xml' | 'both'

/**
 * Scope + output controls for `getSnapshot`.
 *
 * - `ref` omitted → start at the document root (`config.rootElementName`). With
 *   no `ref` and no `depth` this is the whole document; `ancestors`/`siblings`
 *   are inapplicable (the root has none) and ignored.
 * - `ancestors` → how many ancestor levels to include above `ref` (spine).
 * - `siblings` → also include each ancestor-spine node's siblings, so `ref` is
 *   shown in context up the spine. Implies at least `ancestors: 1`.
 *   `true` → shallow siblings; `{ expand: true }` → keep the siblings' subtrees
 *   (still bounded by `depth`).
 * - `depth` → how many levels to descend below the start (default: whole
 *   subtree). Honored with or without `ref` (e.g. `{ depth: 1 }` = root + its
 *   direct children).
 * - `includeDeleted` → re-attach staged-deleted nodes as `status:'deleted'`
 *   tombstones. Tree output only — XML always reflects what will be written.
 * - `omit` / `unwrap` → tree-shape filters applied to tree output only (shared
 *   with `getTree`). XML always reflects the full, unfiltered document. When
 *   `unwrap` is omitted, the config's transparent elements are unwrapped, so the
 *   snapshot matches what the UI shows.
 * - `as` → `'tree'` (default) | `'xml'` | `'both'`.
 */
export type GetSnapshotOptions<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig> = ElementsOf<GenericConfig>,
> = {
	ref?: RefOrRecord<GenericConfig, GenericElement>
	ancestors?: number
	siblings?: boolean | { expand?: boolean }
	depth?: number
	includeDeleted?: boolean
	omit?: OmitEntry<GenericConfig>[]
	unwrap?: ElementsOf<GenericConfig>[]
	as?: SnapshotFormat
	/**
	 * For `as: 'xml'` / `'both'`: emit namespace declarations (`xmlns` / `xmlns:*`).
	 * Defaults to `true`. Set `false` to render a bare fragment (literal, possibly
	 * prefixed tag names, no namespace declarations) that reads like an excerpt
	 * nested in its file rather than a standalone document.
	 */
	declareNamespaces?: boolean
	/**
	 * For `as: 'xml'` / `'both'`: prepend the XML prolog
	 * (`<?xml version="1.0" encoding="UTF-8"?>`). Defaults to `true`. Set `false`
	 * to emit the serialized element(s) without the declaration, e.g. for an
	 * excerpt embedded in another document.
	 */
	includeXmlDeclaration?: boolean
}

export type SnapshotResult = {
	tree: AnyTreeRecord
	xmlString: string
}

/** Flat, scope-bounded record set produced by the collector. */
export type CollectedSnapshot = {
	/** Live records; each `children` array is filtered to ids within the scope. */
	liveRecords: AnyTrackedRecord[]
	/** Staged-deleted tombstones (only populated when `includeDeleted`). */
	deletedRecords: AnyTrackedRecord[]
	/** Id of the outermost record — the root for tree/XML assembly. */
	rootId: string
}
