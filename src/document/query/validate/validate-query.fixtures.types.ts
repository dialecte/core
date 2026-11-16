import type { Document } from '@/document'
import type { DialecteErrorKey } from '@/errors'
import type { BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { ValueIssue } from '@/validation'

/** A case whose check returns an issue, or none. */
export type IssueCase = BaseXmlTestCase & {
	check: (document: Document<TestDialecteConfig>) => Promise<ValueIssue | undefined>
	expected?: ValueIssue
}

/** A case whose check throws a Dialecte error. */
export type ThrowCase = BaseXmlTestCase & {
	check: (document: Document<TestDialecteConfig>) => Promise<ValueIssue | undefined>
	expectedError: DialecteErrorKey
}
