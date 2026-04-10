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

	// D6xxx — Config
	EXTENSION_METHOD_COLLISION: {
		code: 'D6001',
		message: 'Extension method name collision detected',
	},
} as const
