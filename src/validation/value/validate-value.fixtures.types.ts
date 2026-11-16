import type { ValueIssue } from './validate-value.types'
import type { DataType } from '@/types'
import type { NamespaceLookup } from '@/utils'

export type ValueCase = {
	type: DataType
	value: string
	namespaces?: NamespaceLookup
	expected: ValueIssue | undefined
}
