/** What the elements of one tag may hold as QName-typed: attributes by stored name, and whether their text. */
export type QualifiedNamesOfTag = {
	readonly attributes: ReadonlySet<string>
	readonly text: boolean
}
