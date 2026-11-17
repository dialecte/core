import type { AnyRefOrRecord } from '@/document'
import type { AnyAttribute, Namespace } from '@/types'

export type AnyAddChildParams = {
	tagName: string
	attributes: AnyAttribute[] | Record<string, string>
	namespace?: Namespace
	value?: string
	id?: string
}

export type AnyUpdateParams = {
	attributes?: AnyAttribute[] | Record<string, string>
	value?: string
}

/** `MoveParams` of the untyped transaction: where `tx.any.move` puts an element. */
export type AnyMoveParams = {
	parent: AnyRefOrRecord
	before?: AnyRefOrRecord
}
