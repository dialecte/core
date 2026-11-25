import type { NamespaceShape } from './unwrap.fixtures.types'
import type { AnyTreeRecord } from '@/types'

/** A tree node's tag, namespace URI and children: what the namespace cases of the tree reads compare. */
export function toNamespaceShape(record: AnyTreeRecord): NamespaceShape {
	return {
		tagName: record.tagName,
		uri: record.namespace.uri,
		tree: record.tree.map((child) => toNamespaceShape(child as AnyTreeRecord)),
	}
}
