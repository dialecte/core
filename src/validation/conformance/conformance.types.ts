import type { AnyTreeRecord, DataType } from '@/types'
import type { FormValueAttribute, ValueIssue, ValueIssueReason } from '@/validation'

/**
 * A record the engine is expected to flag: its id, why (the `ValueIssue.reason` until a rule catalogue names the
 * rules) and, for an attribute defect, which attribute (absent for a text defect).
 */
export type OracleIssue = {
	readonly at: string
	readonly code: ValueIssueReason
	readonly attribute?: string
}

/**
 * One oracle case: a whole XML document carrying core's record id on every element, one element start per line, and
 * what the engine must say of it - `'valid'`, or the records it flags. libxml2 says which elements are invalid; the
 * case says why.
 */
export type OracleCase = {
	readonly name: string
	readonly document: string
	readonly expected: 'valid' | readonly OracleIssue[]
}

/** One error libxml2 reports: the line where the element's start tag ends, its wording and path (printed, never read). */
export type OracleError = {
	readonly line: number
	readonly message: string
	readonly xpath?: string
}

/** Why core and libxml2 disagree on a value, from a closed vocabulary. */
export type KnownExceptionReason = 'xsd-rule' | 'capability-gap'

/**
 * A value on which core keeps the XSD rule against libxml2's verdict. `xsd` is the `xs:simpleType` named `t` that
 * libxml2 judges a one-element document against; `core` is core's verdict, `'admitted'` or the issue reason.
 */
export type KnownException = {
	readonly id: string
	readonly value: string
	readonly type: DataType
	readonly xsd: string
	readonly core: 'admitted' | ValueIssueReason
	readonly reason: KnownExceptionReason
}

/** The content of `known-exceptions.json`. */
export type KnownExceptionsFile = {
	readonly libxml2Wasm: string
	readonly rows: readonly KnownException[]
}

/** `query.validate.value` as the value scan calls it: names read from the document, not known to the compiler. */
export type JudgeValue = (params: {
	parent: AnyTreeRecord
	tagName: string
	xsiType?: string
	attribute?: FormValueAttribute
	value: string
}) => Promise<ValueIssue | undefined>
