import { dialecteState } from '@/dialecte'
import { createError } from '@/errors'
import { toChainRecord, addStagedOperation, standardizeRecord } from '@/helpers'

import { AddChildParams } from './create.types'

import type { ChainFactory } from '../types'
import type {
	AnyDialecteConfig,
	ElementsOf,
	ChildrenOf,
	Context,
	ChainRecord,
	RawRecord,
} from '@/types'

/**
 * Creates a child element under the current focused element.
 *
 * @param chain - Chain factory to create new builder instances
 * @param contextPromise - Current chain context
 * @param dialecteConfig - Dialecte configuration
 * @returns Function to create element (sync chainable)
 */
export function createAddChildMethod<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
>(params: {
	chain: ChainFactory
	contextPromise: Promise<Context<GenericConfig, GenericElement>>
	dialecteConfig: GenericConfig
}) {
	const { chain, contextPromise, dialecteConfig } = params

	return function <GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>>(
		params: AddChildParams<GenericConfig, GenericElement, GenericChildElement>,
	) {
		const { id, tagName, attributes, namespace, value, setFocus = false } = params

		const childRecordId = id ?? crypto.randomUUID()

		const newContextPromise = contextPromise.then((context) => {
			try {
				dialecteState.setOperation(`Creating ${tagName}`)

				const standardizedRecord = standardizeRecord({
					record: {
						id: childRecordId,
						tagName,
						attributes,
						namespace,
						value,
					},
					dialecteConfig,
				})

				const { childRecord, updatedParent } = createAndStageChild({
					record: standardizedRecord,
					context,
					dialecteConfig,
				})

				if (setFocus)
					return {
						...context,
						currentFocus: childRecord,
					} satisfies Context<GenericConfig, GenericChildElement>
				else
					return {
						...context,
						currentFocus: updatedParent,
					} satisfies Context<GenericConfig, GenericElement>
			} catch (error) {
				const dialecteError = createError({
					errorKey: 'CREATE_CHILD_ERROR',
					context: {
						method: 'addChild',
						currentFocus: context.currentFocus,
						operations: context.stagedOperations,
						tagName,
						originalError: error,
					},
				})
				dialecteState.setError(dialecteError)
				throw dialecteError
			}
		})

		if (setFocus) {
			return chain<GenericConfig, GenericChildElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericChildElement>>,
			})
		} else {
			return chain<GenericConfig, GenericElement>({
				contextPromise: newContextPromise as Promise<Context<GenericConfig, GenericElement>>,
			})
		}
	}
}

/**
 * Create child record and stage operations
 */
function createAndStageChild<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
	GenericChildElement extends ChildrenOf<GenericConfig, GenericElement>,
>(params: {
	record: RawRecord<GenericConfig, GenericChildElement>
	context: Context<GenericConfig, GenericElement>
	dialecteConfig: GenericConfig
}): {
	childRecord: ChainRecord<GenericConfig, GenericChildElement>
	updatedParent: ChainRecord<GenericConfig, GenericElement>
} {
	const { record, context, dialecteConfig } = params

	const childRecord: RawRecord<GenericConfig, GenericChildElement> = {
		...record,
		parent: { id: context.currentFocus.id, tagName: context.currentFocus.tagName },
		children: [],
	}

	addStagedOperation({ context, status: 'created', record: childRecord })

	const updatedParent: ChainRecord<GenericConfig, GenericElement> = {
		...context.currentFocus,
		children: [
			...context.currentFocus.children,
			{
				id: childRecord.id,
				tagName: childRecord.tagName as ElementsOf<GenericConfig>,
			},
		],
	}

	addStagedOperation({
		context,
		status: 'updated',
		oldRecord: context.currentFocus,
		newRecord: updatedParent,
	})

	if (dialecteConfig.hooks?.afterCreated) {
		const hookOperations = dialecteConfig.hooks.afterCreated({
			childRecord: childRecord,
			parentRecord: context.currentFocus,
			context,
		})

		for (const operation of hookOperations) {
			if (operation.status === 'created') {
				addStagedOperation({ context, status: 'created', record: operation.newRecord })
			} else if (operation.status === 'updated') {
				addStagedOperation({
					context,
					status: 'updated',
					oldRecord: operation.oldRecord,
					newRecord: operation.newRecord,
				})
			}
		}
	}

	return {
		childRecord: toChainRecord({ record: childRecord, status: 'created' }),
		updatedParent: toChainRecord({ record: updatedParent, status: 'updated' }),
	}
}
