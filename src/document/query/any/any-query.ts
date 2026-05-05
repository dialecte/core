import { findAncestors, findByAttributes, findDescendants } from '../find'
import { getTree } from '../get'
import {
	getAttribute,
	getAttributes,
	getAttributeFullObject,
	getAttributesFullObject,
} from '../get/attribute'
import { getRecord, getRecords, getRecordsByTagName, getChild, getChildren } from '../get/record'

import { toRef } from '@/helpers'

import type { Context } from '../../types'
import type {
	AnyAttribute,
	AnyDialecteConfig,
	AnyRef,
	AnyRefOrRecord,
	AnyTrackedRecord,
	AnyTreeRecord,
	ElementsOf,
	Ref,
} from '@/types'

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

	async getRecordsByTagName(tagName: string): Promise<AnyTrackedRecord[]> {
		return getRecordsByTagName({
			context: this.getContext(),
			tagName: tagName as ElementsOf<GenericConfig>,
		})
	}

	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { name: string; fullObject?: false },
	): Promise<string>
	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { name: string; fullObject: true },
	): Promise<AnyAttribute | undefined>
	async getAttribute(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { name: string; fullObject?: boolean },
	): Promise<string | AnyAttribute | undefined> {
		const ref = toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>
		const { fullObject } = params
		if (fullObject) return getAttributeFullObject({ context: this.getContext(), ref, ...params })
		return getAttribute({ context: this.getContext(), ref, ...params })
	}

	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params?: { fullObject?: false },
	): Promise<Record<string, string>>
	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params: { fullObject: true },
	): Promise<AnyAttribute[]>
	async getAttributes(
		refOrRecord: AnyRefOrRecord | undefined,
		params?: { fullObject?: boolean },
	): Promise<Record<string, string> | AnyAttribute[]> {
		const ref = toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>
		const { fullObject } = params || {}
		if (fullObject) return getAttributesFullObject({ context: this.getContext(), ref, ...params })
		return getAttributes({ context: this.getContext(), ref, ...params })
	}

	async getTree(refOrRecord: AnyRefOrRecord | undefined): Promise<AnyTreeRecord | undefined> {
		return getTree({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			dialecteConfig: this.dialecteConfig,
		}) as Promise<AnyTreeRecord | undefined>
	}

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

	async findAncestors(refOrRecord: AnyRefOrRecord | undefined): Promise<AnyTrackedRecord[]> {
		if (!refOrRecord) return []
		return findAncestors({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
		}) as Promise<AnyTrackedRecord[]>
	}

	async findByAttributes(params: {
		tagName: string
		attributes: Record<string, string | string[]>
	}): Promise<AnyTrackedRecord[]> {
		return findByAttributes({
			context: this.getContext(),
			tagName: params.tagName as ElementsOf<GenericConfig>,
			attributes: params.attributes as any,
		}) as Promise<AnyTrackedRecord[]>
	}
}
