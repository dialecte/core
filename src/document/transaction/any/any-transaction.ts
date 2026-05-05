import { AnyQuery } from '../../query/any'
import { stageDeepClone } from '../clone'
import { stageAddChild } from '../create'
import { stageDelete } from '../delete'
import { stageEnsureChild } from '../ensure'
import { stageUpdate } from '../update'

import { toRef } from '@/helpers'

import type { AddChildParams } from '../create'
import type { UpdateParams } from '../update'
import type { AnyAddChildParams, AnyUpdateParams } from './any.types'
import type { Query } from '@/document/query/main'
import type { Context } from '@/document/types'
import type {
	AnyDialecteConfig,
	AnyRawRecord,
	AnyRefOrRecord,
	AnyTrackedRecord,
	AnyTreeRecord,
	ElementsOf,
	Ref,
	TreeRecord,
	TransactionHooks,
} from '@/types'

/**
 * Untyped transaction namespace - bypasses ElementsOf/ChildrenOf constraints for mutations.
 * Extends AnyQuery to provide the full untyped read+write surface.
 *
 * Accessible via `transaction.any.*`.
 */
export class AnyTransaction<
	GenericConfig extends AnyDialecteConfig,
> extends AnyQuery<GenericConfig> {
	private hooks: TransactionHooks<GenericConfig> | undefined
	private query: Query<GenericConfig>

	constructor(
		getContext: () => Context<GenericConfig>,
		dialecteConfig: GenericConfig,
		hooks: TransactionHooks<GenericConfig> | undefined,
		query: Query<GenericConfig>,
	) {
		super(getContext, dialecteConfig)
		this.hooks = hooks
		this.query = query
	}

	async addChild(parent: AnyRefOrRecord, params: AnyAddChildParams): Promise<AnyRawRecord> {
		return stageAddChild({
			context: this.getContext(),
			parentRef: toRef(parent) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			params: {
				id: params.id,
				tagName: params.tagName,
				attributes: params.attributes,
				namespace: params.namespace,
				value: params.value,
			} as AddChildParams<GenericConfig, ElementsOf<GenericConfig>, ElementsOf<GenericConfig>>,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this.query,
		}) as Promise<AnyRawRecord>
	}

	async ensureChild(
		parent: AnyRefOrRecord,
		params: AnyAddChildParams,
	): Promise<AnyTrackedRecord | AnyRawRecord> {
		return stageEnsureChild({
			context: this.getContext(),
			parentRef: toRef(parent) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			params: {
				id: params.id,
				tagName: params.tagName,
				attributes: params.attributes,
				namespace: params.namespace,
				value: params.value,
			} as AddChildParams<GenericConfig, ElementsOf<GenericConfig>, ElementsOf<GenericConfig>>,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this.query,
		}) as Promise<AnyTrackedRecord | AnyRawRecord>
	}

	async update(refOrRecord: AnyRefOrRecord, params: AnyUpdateParams): Promise<AnyRawRecord> {
		return stageUpdate({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			params: {
				attributes: params.attributes,
				value: params.value,
			} as UpdateParams<GenericConfig, ElementsOf<GenericConfig>>,
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			query: this.query,
		}) as Promise<AnyRawRecord>
	}

	async delete(refOrRecord: AnyRefOrRecord): Promise<AnyRawRecord> {
		return stageDelete({
			context: this.getContext(),
			ref: toRef(refOrRecord) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			hooks: this.hooks,
			query: this.query,
		}) as Promise<AnyRawRecord>
	}

	async deepClone(
		parent: AnyRefOrRecord,
		tree: AnyTreeRecord,
	): Promise<{
		record: AnyRawRecord
		mappings: {
			source: { tagName: string; id?: string }
			target: { tagName: string; id?: string }
		}[]
	}> {
		const result = await stageDeepClone({
			dialecteConfig: this.dialecteConfig,
			hooks: this.hooks,
			context: this.getContext(),
			query: this.query,
			parentRef: toRef(parent) as Ref<GenericConfig, ElementsOf<GenericConfig>>,
			record: tree as unknown as TreeRecord<GenericConfig, ElementsOf<GenericConfig>>,
			cumulativeCloneMappings: [],
		})
		return result as {
			record: AnyRawRecord
			mappings: {
				source: { tagName: string; id?: string }
				target: { tagName: string; id?: string }
			}[]
		}
	}
}
