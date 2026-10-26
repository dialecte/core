export const ERROR_CATALOG = {
	// D0xxx — Generic
	UNKNOWN: {
		code: 'D0001',
		message: 'An unknown error occurred',
	},
	ASSERTION_FAILED: {
		code: 'D0002',
		message: 'Assertion failed',
	},

	// D1xxx — Store/persistence
	STORE_CONNECTION_FAILED: {
		code: 'D1001',
		message: 'Failed to open database',
	},
	STORE_COMMIT_FAILED: {
		code: 'D1002',
		message: 'Failed to commit changes',
	},
	STORE_RECORD_NOT_FOUND: {
		code: 'D1003',
		message: 'Record not found in database',
	},
	STORE_BULK_ADD_FAILED: {
		code: 'D1004',
		message: 'Failed to add records to database',
	},
	STORE_BULK_UPDATE_FAILED: {
		code: 'D1005',
		message: 'Failed to update records in database',
	},
	STORE_DELETE_FAILED: {
		code: 'D1006',
		message: 'Failed to delete records from database',
	},
	STORE_NOT_WRITABLE: {
		code: 'D1007',
		message: 'Store is not writable',
	},
	STORE_BLOB_NOT_FOUND: {
		code: 'D1008',
		message: 'Blob not found',
	},
	STORE_DUPLICATE_ID: {
		code: 'D1009',
		message: 'An id is already taken in the store',
	},
	STORE_CLOSED: {
		code: 'D1010',
		message: 'Store is closed',
	},
	STORE_PROTOCOL_MISMATCH: {
		code: 'D1012',
		message: 'Another version of the library holds the shared store connection',
	},
	STORE_REALM_ID_TAKEN: {
		code: 'D1013',
		message: 'A view with this id is already connected to the shared store',
	},
	STORE_REALM_UNKNOWN: {
		code: 'D1014',
		message: 'The shared store does not know this view',
	},

	// D2xxx — Element lookup
	ELEMENT_NOT_FOUND: {
		code: 'D2001',
		message: 'Element not found',
	},
	ROOT_NOT_FOUND: {
		code: 'D2002',
		message: 'Root element not found',
	},
	DUPLICATE_ID: {
		code: 'D2003',
		message: 'Duplicate element ID',
	},
	ELEMENT_TAGNAME_MISMATCH: {
		code: 'D2004',
		message: 'Element tagName does not match the expected type',
	},

	// D3xxx — Constraint violations
	INVALID_PARENT_CHILD: {
		code: 'D3001',
		message: 'Invalid parent-child relationship',
	},
	INVALID_ATTRIBUTE: {
		code: 'D3002',
		message: 'Invalid attribute for element',
	},
	PROTECTED_ROOT: {
		code: 'D3003',
		message: 'Root element cannot be deleted',
	},
	REQUIRED_ATTRIBUTE_MISSING: {
		code: 'D3004',
		message: 'Required attribute is missing',
	},
	UNIQUE_CONSTRAINT_VIOLATION: {
		code: 'D3005',
		message: 'Value is already used within its scope',
	},
	UNKNOWN_NAMESPACE_PREFIX: {
		code: 'D3006',
		message:
			'Unknown namespace prefix on attribute — pass it explicitly as { name, namespace: { prefix, uri } }',
	},
	PREFIXED_ATTRIBUTE_NAME: {
		code: 'D3007',
		message:
			'Authored attribute name must be a local name — pass the namespace separately as { name, namespace }, not a prefixed name',
	},
	FIXED_VALUE_VIOLATION: {
		code: 'D3008',
		message: 'Attribute value differs from the schema-fixed value',
	},
	XSI_TYPE_REQUIRED: {
		code: 'D3009',
		message: 'The element is declared with an abstract type: name a type with xsi:type',
	},
	XSI_TYPE_NOT_ADMITTED: {
		code: 'D3010',
		message: 'The element may not take the type named with xsi:type',
	},
	XSI_TYPE_CHANGE_LEAVES_CONTENT: {
		code: 'D3011',
		message: 'The new xsi:type does not admit content the element still holds',
	},

	// D4xxx — Transaction lifecycle
	ALREADY_COMMITTED: {
		code: 'D4001',
		message: 'Transaction already committed',
	},
	ALREADY_FAILED: {
		code: 'D4002',
		message: 'Transaction already failed',
	},
	DATABASE_COMMIT_ERROR: {
		code: 'D4003',
		message: 'An error occurred while committing changes to the database',
	},
	CONCURRENT_TRANSACTION: {
		code: 'D4004',
		message:
			'A transaction is already in progress. Concurrent transactions are not supported yet — serialize them or implement a transaction queue.',
	},

	// D5xxx — Import/Export
	EXPORT_ROOT_NOT_FOUND: {
		code: 'D5001',
		message: 'Root element not found in records during export',
	},
	EXPORT_ORPHAN_CHILD_REF: {
		code: 'D5002',
		message: 'Parent references non-existent child record',
	},
	PARSE_ERROR: {
		code: 'D5003',
		message: 'Failed to parse XML',
	},
	IMPORT_FAILED: {
		code: 'D5004',
		message: 'Failed to import the file',
	},
	IMPORT_ABORTED: {
		code: 'D5005',
		message: 'The import was aborted',
	},
	EXPORT_CONFLICT: {
		code: 'D5006',
		message: 'The document changed while it was exported',
	},
	EXPORT_ABORTED: {
		code: 'D5007',
		message: 'The export was aborted',
	},

	// D6xxx — Config
	EXTENSION_METHOD_COLLISION: {
		code: 'D6001',
		message: 'Extension method name collision detected',
	},

	// D7xxx — Project
	UNKNOWN_CONFIG_KEY: {
		code: 'D7001',
		message: 'Unknown config key',
	},
	DOCUMENT_NOT_REGISTERED: {
		code: 'D7002',
		message: 'Document not registered in project',
	},
	PROJECT_NOT_OPENED: {
		code: 'D7003',
		message: 'Project not opened',
	},
	BLOB_NOT_FOUND: {
		code: 'D7004',
		message: 'Blob not found in store',
	},
	PROJECT_ENGINE_UNAVAILABLE: {
		code: 'D7006',
		message: 'No view can start the project engine',
	},
	PROJECT_ENGINE_BUSY: {
		code: 'D7007',
		message: 'The project is still held by another engine',
	},
	PROJECT_DIALECTE_MISMATCH: {
		code: 'D7008',
		message: 'The project is open with another dialecte',
	},
	PROJECT_DIALECTE_VERSION_MISMATCH: {
		code: 'D7009',
		message: 'The project engine runs another version of the dialecte',
	},
} as const
