import type { GetTreeParams, Ref, Transaction } from '@/document'
import type { BaseXmlTestCase, TestDialecteConfig } from '@/test'
import type { AnyDialecteConfig, ElementsOf } from '@/types'

/** A tree as its tag names: what the getTree tables compare. */
export type TreeShape = { tagName: string; tree: TreeShape[] }

/** One getTree table case: a document, the ref and options read, the tree expected. */
export type GetTreeCase<GenericConfig extends AnyDialecteConfig> = BaseXmlTestCase & {
	ref: Ref<GenericConfig, ElementsOf<GenericConfig>>
	options?: GetTreeParams<GenericConfig, ElementsOf<GenericConfig>>
	expectedShape: TreeShape
}

/** A lazy getTree case: a `depth` or `expanded` read, with staged writes pending when `stage` is given. */
export type LazyTreeCase<GenericConfig extends AnyDialecteConfig> = GetTreeCase<GenericConfig> & {
	stage?: (tx: Transaction<GenericConfig>) => Promise<void>
}

/** The test dialecte where AAA_1 contains AAA_1 (self-recursive). */
export type RecursiveTestDialecteConfig = Omit<TestDialecteConfig, 'children'> & {
	readonly children: Omit<TestDialecteConfig['children'], 'AAA_1'> & {
		readonly AAA_1: readonly ['AAAA_1', 'AAAA_2', 'AAAA_3', 'AAA_1']
	}
}

/** The test dialecte where AA_1 is transparent. */
export type TransparentTestDialecteConfig = TestDialecteConfig & {
	readonly transparentElements: readonly ['AA_1']
}
