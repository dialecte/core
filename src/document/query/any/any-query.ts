import {
	findAncestors,
	findAncestorsOfEach,
	findByAttributes,
	findDescendants,
	findDescendantsOfEach,
} from '../find'
import { getDefinition, getTree } from '../get'
import {
	getAttribute,
	getAttributes,
	getAttributeFullObject,
	getAttributesFullObject,
} from '../get/attribute'
import {
	getRecord,
	getRecords,
	getRecordsByTagName,
	getChild,
	getChildren,
	getChildrenOfEach,
} from '../get/record'
import { getSnapshot } from '../snapshot'

import { toRef } from '@/helpers'

import type { Context } from '../../types'
import type { GetTreeParams } from '../get'
import type { GetSnapshotOptions, SnapshotResult } from '../snapshot'
import type { AnyRef, AnyRefOrRecord, FilterAttributes, Ref, RefOrRecord } from '@/document'
import type {
	AnyAttribute,
	AnyDialecteConfig,
	AnyTrackedRecord,
	AnyTreeRecord,
	ElementsOf,
	ResolvedDefinition,
} from '@/types'
import type { AttributeDefaults } from '@/utils'

/**
 * Untyped query namespace - bypasses ElementsOf/ChildrenOf constraints.
 * Use for custom/private elements or dynamic contexts where the type system is a burden.
 *
 * Accessible via `query.any.*` or `transaction.any.*`.
 */
export class AnyQuery<GenericConfig extends AnyDialecteConfig> {
	constructor(
		protected getContext: () => Context<GenericConfig>,
		protected dialecteConfig: GenericConfig,
	) {}

	async getRecord(ref: AnyRef): Promise<AnyTrackedRecord | undefined> {
		return getRecord({
			context: this.getContext(),
			ref: ref as Ref<GenericConfig, ElementsOf<GenericConfig>>,
		})
	}

	/** The definition of the element in its context: as declared under its parent when the schema declares the tag differently there. */
	async getDefinition(ref: AnyRefOrRecord): Promise<ResolvedDefinition | undefined> {
		return getDefinition({
			context: this.getContext(),
			ref: toRef(ref) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
		})
	}

	async getRecords(refs: AnyRef[]): Promise<(AnyTrackedRecord | undefined)[]> {
		return getRecords({
			context: this.getContext(),
			refs: refs as Ref<GenericConfig, ElementsOf<GenericConfig>>[],
		})
	}

	async getChild(parent: AnyRefOrRecord, tagName: string): Promise<AnyTrackedRecord | undefined> {
		return getChild({
			context: this.getContext(),
			ref: toRef(parent) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			tagName: tagName as ElementsOf<GenericConfig>,
		})
	}

	async getChildren(parent: AnyRefOrRecord, tagName: string): Promise<AnyTrackedRecord[]> {
		return getChildren({
			context: this.getContext(),
			ref: toRef(parent) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			tagName: tagName as ElementsOf<GenericConfig>,
		})
	}

	/** The children of a tag of each parent, through transparent elements, one list per input position: at most three reads, a record given used as given. */
	async getChildrenOfEach(
		refsOrRecords: ReadonlyArray<AnyRefOrRecord>,
		params: { tagName: string },
	): Promise<AnyTrackedRecord[][]> {
		return getChildrenOfEach({
			context: this.getContext(),
			refsOrRecords: refsOrRecords as ReadonlyArray<
				RefOrRecord<GenericConfig, ElementsOf<GenericConfig>>
			>,
			tagName: params.tagName as ElementsOf<GenericConfig>,
		}) as Promise<AnyTrackedRecord[][]>
	}

	async getRecordsByTagName(tagName: string): Promise<AnyTrackedRecord[]> {
		return getRecordsByTagName({
			context: this.getContext(),
			tagName: tagName as ElementsOf<GenericConfig>,
		})
	}

	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { name: string; namespace?: string; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<string>
	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { name: string; namespace?: string; fullObject: true; defaults?: AttributeDefaults },
	): Promise<AnyAttribute | undefined>
	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: {
			name: string
			namespace?: string
			fullObject?: boolean
			defaults?: AttributeDefaults
		},
	): Promise<string | AnyAttribute | undefined> {
		const ref = refOrRecord as RefOrRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
		const { fullObject } = params
		if (fullObject) return getAttributeFullObject({ context: this.getContext(), ref, ...params })
		return getAttribute({ context: this.getContext(), ref, ...params })
	}

	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params?: { namespace?: string; fullObject?: false; defaults?: AttributeDefaults },
	): Promise<Record<string, string>>
	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { namespace?: string; fullObject: true; defaults?: AttributeDefaults },
	): Promise<AnyAttribute[]>
	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params?: { namespace?: string; fullObject?: boolean; defaults?: AttributeDefaults },
	): Promise<Record<string, string> | AnyAttribute[]> {
		const ref = refOrRecord as RefOrRecord<GenericConfig, ElementsOf<GenericConfig>> | undefined
		const { fullObject } = params || {}
		if (fullObject) return getAttributesFullObject({ context: this.getContext(), ref, ...params })
		return getAttributes({ context: this.getContext(), ref, ...params })
	}

	async getTree(
		refOrRecord: AnyRefOrRecord | undefined,
		options?: GetTreeParams<AnyDialecteConfig, ElementsOf<AnyDialecteConfig>>,
	): Promise<AnyTreeRecord | undefined> {
		return getTree({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			options: options as GetTreeParams<GenericConfig, ElementsOf<GenericConfig>>,
			dialecteConfig: this.dialecteConfig,
		}) as Promise<AnyTreeRecord | undefined>
	}

	async getSnapshot(
		options?: GetSnapshotOptions<AnyDialecteConfig> & { as?: 'tree' },
	): Promise<AnyTreeRecord>
	async getSnapshot(options: GetSnapshotOptions<AnyDialecteConfig> & { as: 'xml' }): Promise<string>
	async getSnapshot(
		options: GetSnapshotOptions<AnyDialecteConfig> & { as: 'both' },
	): Promise<SnapshotResult>
	async getSnapshot(
		options?: GetSnapshotOptions<AnyDialecteConfig>,
	): Promise<AnyTreeRecord | string | SnapshotResult> {
		return getSnapshot({
			context: this.getContext(),
			options: options as GetSnapshotOptions<GenericConfig>,
		})
	}

	/** Every descendant of the element, grouped by tag name; a group's records come in no guaranteed order. */
	async findDescendants(
		refOrRecord: AnyRefOrRecord | undefined,
	): Promise<Record<string, AnyTrackedRecord[]>> {
		const ref = toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>
		const collectAll = (this.dialecteConfig.descendants[ref.tagName] ?? []) as string[]
		return findDescendants({
			context: this.getContext(),
			ref,
			options: { collect: collectAll },
		}) as Promise<Record<string, AnyTrackedRecord[]>>
	}

	/**
	 * Every descendant of each element, one answer per input position, grouped by tag name as `findDescendants` here:
	 * one walk for all the elements; `query.findDescendantsOfEach` takes a collect and an omit.
	 */
	async findDescendantsOfEach(
		refsOrRecords: ReadonlyArray<AnyRefOrRecord>,
	): Promise<Record<string, AnyTrackedRecord[]>[]> {
		return findDescendantsOfEach({
			context: this.getContext(),
			refsOrRecords: refsOrRecords as ReadonlyArray<
				RefOrRecord<GenericConfig, ElementsOf<GenericConfig>>
			>,
		}) as Promise<Record<string, AnyTrackedRecord[]>[]>
	}

	async findAncestors(refOrRecord: AnyRefOrRecord | undefined): Promise<AnyTrackedRecord[]> {
		if (!refOrRecord) return []
		return findAncestors({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
		}) as Promise<AnyTrackedRecord[]>
	}

	/**
	 * The ancestors of each element, one list per input position: one read per ancestor level, a record given used as
	 * given. Bottom-up, no options, as `findAncestors` here; `query.findAncestorsOfEach` takes them.
	 */
	async findAncestorsOfEach(
		refsOrRecords: ReadonlyArray<AnyRefOrRecord>,
	): Promise<AnyTrackedRecord[][]> {
		return findAncestorsOfEach({
			context: this.getContext(),
			refsOrRecords: refsOrRecords as ReadonlyArray<
				RefOrRecord<GenericConfig, ElementsOf<GenericConfig>>
			>,
		}) as Promise<AnyTrackedRecord[][]>
	}

	async findByAttributes(params: {
		tagName: string
		attributes: Record<string, string | string[]>
	}): Promise<AnyTrackedRecord[]> {
		return findByAttributes({
			context: this.getContext(),
			tagName: params.tagName as ElementsOf<GenericConfig>,
			attributes: params.attributes as FilterAttributes<GenericConfig, ElementsOf<GenericConfig>>,
		}) as Promise<AnyTrackedRecord[]>
	}
}
