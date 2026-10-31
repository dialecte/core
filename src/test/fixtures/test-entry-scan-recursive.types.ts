/** What the scan fixture of self-referencing generics names: exported here, never by the fixture module the scan reads. */
export type DeepRow = { value: string }

/** Names `DeepRow` only at its second level: `Recursive<number>` holds `Recursive<string>`. */
export type Recursive<GenericValue> = {
	value: GenericValue extends string ? DeepRow : never
	next: Recursive<string>
}

/** The same, as an interface. */
export interface RecursiveInterface<GenericValue> {
	value: GenericValue extends string ? DeepRow : never
	next: RecursiveInterface<string>
}
