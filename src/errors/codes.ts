export const ERROR_CATALOG = {
	// 000-099: Generic errors
	UNKNOWN_ERROR: {
		code: 'D001',
		message: 'An unknown error occurred',
	},

	// 100-199: Database errors
	DATABASE_OPEN_ERROR: {
		code: 'D101',
		message: 'Failed to open database',
	},
	DATABASE_TRANSACTION_ERROR: {
		code: 'D102',
		message: 'Database transaction failed',
	},
	DATABASE_RECORD_NOT_FOUND: {
		code: 'D103',
		message: 'Record not found in database',
	},
	DATABASE_BULK_ADD_ERROR: {
		code: 'D104',
		message: 'Failed to add records to database',
	},
	DATABASE_BULK_UPDATE_ERROR: {
		code: 'D105',
		message: 'Failed to update records in database',
	},
	DATABASE_DELETE_ERROR: {
		code: 'D106',
		message: 'Failed to delete records from database',
	},
	DATABASE_COMMIT_ERROR: {
		code: 'D107',
		message: 'Failed to commit changes to database',
	},

	// 200-299: Import/Export errors

	// 300-399: Chain method errors
	CREATE_CHILD_ERROR: {
		code: 'D301',
		message: 'Failed to create child element',
	},

	// 400-499: Validation errors

	// 500-599: Flavor configuration errors
} as const
