/** A tree node as the namespace cases compare it: its tag, its namespace URI and its children. */
export type NamespaceShape = { tagName: string; uri: string; tree: NamespaceShape[] }
