/** What the scan fixture of edge cases names: exported here, never by the fixture module the scan reads. */
export type EdgeRow = { value: string }

/** A generic that expands on every level (`Tree<T>` holds `Tree<T[]>`): a scan that follows it naively never ends. */
export type Tree<GenericLeaf> = { leaf: GenericLeaf; children: Tree<GenericLeaf[]>[] }
