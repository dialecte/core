/** The read members a store may answer with the document's version (`Store.readVersioned`): anything else is refused. */
export const VERSIONED_READ_MEMBERS = [
	'get',
	'getMany',
	'getByTagNameInDocument',
	'getByAttributes',
	'getByDocumentId',
] as const
