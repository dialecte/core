/** What the scan fixture of other type shapes names: exported here, never by the fixture module the scan reads. */
export type ShapeRow = { value: string }

/** A generic of the test entry that reads its parameter through a member (`brand`): reached either way. */
export type Box<GenericContent> = { id: string; brand?: (content: GenericContent) => never }

/** A generic of the test entry that never reads its parameter (a phantom one): reached only as a type argument. */
export interface Tagged<GenericTag> {
	label: string
}
