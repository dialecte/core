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
