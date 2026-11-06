import { CORE_DOCS_URL } from './errors.constants'

export const ERROR_CATALOG = {
	// D0xxx — Generic
	UNKNOWN: {
		code: 'D0001',
		message: 'An unknown error occurred',
		explanation: {
			when: "A transaction's callback threw something that is not a structured error (a plain `Error`, a value); the original is its `cause`.",
			fix: 'Read `cause` and `detail`; raise your own failures with `throwDialecteError` or `invariant` so callers get a key.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	ASSERTION_FAILED: {
		code: 'D0002',
		message: 'Assertion failed',
		explanation: {
			when: 'An `invariant` without its own key failed, or core met a state it never expects (a catalogue built wrong, an inconsistent export, a store running on a dependency older than the one it supports).',
			fix: 'Read `detail`: it names the condition. Give `invariant` a key of its own when the failure is one a caller should handle.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},

	// D1xxx — Store/persistence
	STORE_CONNECTION_FAILED: {
		code: 'D1001',
		message: 'Failed to open database',
		explanation: {
			when: "The store could not open the project's data, or could not reach what serves it (its database, a worker, a server): it failed to start, was blocked, or went unanswered; the failure is the `cause` when there is one.",
			fix: "Check the browser supports what the store needs and that no other tab holds the project; reload, or open the project with another storage. The store's own docs name what it needs.",
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_COMMIT_FAILED: {
		code: 'D1002',
		message: 'Failed to commit changes',
		explanation: {
			when: "The database refused a transaction's write as it committed (the failure is the `cause`).",
			fix: 'Read `cause`; a full disk or a lost connection are the usual reasons. Retry the transaction once the store is back.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_RECORD_NOT_FOUND: {
		code: 'D1003',
		message: 'Record not found in database',
		explanation: {
			when: 'A write updated or deleted a record the store does not hold in that document.',
			fix: 'Read the record again before writing: it was deleted, or the ref names another document.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_BULK_ADD_FAILED: {
		code: 'D1004',
		message: 'Failed to add records to database',
		explanation: {
			when: 'The database refused to add a batch of records (import, commit); the failure is the `cause`.',
			fix: 'Read `cause`; a full disk or a closed store are the usual reasons.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_BULK_UPDATE_FAILED: {
		code: 'D1005',
		message: 'Failed to update records in database',
		explanation: {
			when: 'The database refused to update a batch of records; the failure is the `cause`.',
			fix: 'Read `cause`; a full disk or a closed store are the usual reasons.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_DELETE_FAILED: {
		code: 'D1006',
		message: 'Failed to delete records from database',
		explanation: {
			when: 'The database refused to delete records; the failure is the `cause`.',
			fix: 'Read `cause`; a closed store is the usual reason.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_NOT_WRITABLE: {
		code: 'D1007',
		message: 'Store is not writable',
		explanation: {
			when: 'A write reached an in-memory store created read-only.',
			fix: "Create the project with `storage: { type: 'inMemory', writable: true }` when the script writes.",
			docs: `${CORE_DOCS_URL}/api/project#in-memory-storage`,
		},
	},
	STORE_BLOB_NOT_FOUND: {
		code: 'D1008',
		message: 'Blob not found',
		explanation: {
			when: 'A blob operation named a blob id the store does not hold.',
			fix: 'List the blobs (`project.getBlobsByDocument`) and use an id from there.',
			docs: `${CORE_DOCS_URL}/api/project#blobs`,
		},
	},
	STORE_DUPLICATE_ID: {
		code: 'D1009',
		message: 'An id is already taken in the store',
		explanation: {
			when: 'A write would create a record (or register a document) with an id the store already holds; `meta.recordIds` lists them.',
			fix: 'Let core mint ids (omit `id`), or pick ids no record of the document has; `deepClone` mints new ids itself.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_CLOSED: {
		code: 'D1010',
		message: 'Store is closed',
		explanation: {
			when: 'A store operation was still in flight when its store closed, or code holding the store itself (a custom store, a test context) called it after its `close()`. A project closed with `project.close()` answers `PROJECT_NOT_OPENED` instead.',
			fix: 'Await every operation before closing the store or the project; open it again before using it.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	STORE_READ_FAILED: {
		code: 'D1011',
		message: 'Failed to read from database',
		explanation: {
			when: "The store's database failed under a read; the failure is the `cause`.",
			fix: 'Read `cause`; reopen the project. A lasting failure means the file is damaged: import its documents again.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_VALUE_NOT_JSON: {
		code: 'D1015',
		message: 'A value handed to the store is not JSON',
		explanation: {
			when: 'A write handed the store a value that is not plain JSON (a function, a Map, undefined, a class instance) in a record or in document metadata.',
			fix: 'Pass plain strings, numbers, booleans, arrays and objects; `detail` names the value and the field.',
			docs: `${CORE_DOCS_URL}/io/#values-a-store-keeps`,
		},
	},
	STORE_UNAVAILABLE: {
		code: 'D1016',
		message: 'This browser gives the page no storage for a project',
		explanation: {
			when: 'The browser gives the page none of the storage the store needs (a private window, an API the browser lacks), so it cannot create, open or destroy the project; nothing is changed.',
			fix: "Open the app in a normal (not private) window of a browser that supports what the project's store needs, or open the project with another storage.",
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_QUOTA_EXCEEDED: {
		code: 'D1017',
		message: 'Not enough storage left for the project',
		explanation: {
			when: "The origin has too little storage left for what the call needs (a new project's files, an import's room ahead of it), or the store's storage refused a write for want of space; nothing of the call applied. A store that checks the room it needs answers it; the local (IndexedDB) store answers the failing write's own error (`STORE_COMMIT_FAILED`, `STORE_BULK_ADD_FAILED`, `STORE_BULK_UPDATE_FAILED`; an import `IMPORT_FAILED`); the in-memory store has no limit.",
			fix: 'Free storage for the origin (delete projects no longer needed) or import a smaller file, then try again; `meta.needed` and `meta.available` give the sizes when known.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	STORE_CONNECTION_LOST: {
		code: 'D1018',
		message: 'The store lost its connection',
		explanation: {
			when: "A call to a store whose project is served elsewhere (a worker, another realm, a server) lost its connection to what serves it: that went away or gave no answer within its budget, sent nothing for too long while the call waited (the call may still finish), or dropped this view. `meta.reason` is the store's own word for why, listed in its docs; a write's refusal carries `meta.writeId`.",
			fix: "A Document's commit and a Project's import ask the outcome themselves, once: a commit that landed resolves; otherwise the refusal says `meta.outcome` - `not-applied` (make it again if wanted), `running` (what serves the store may still apply it: tell the user, read again later), `unknown` (it could not be asked), or `applied` for an import (its document is in the project; its diagnostics were lost). Elsewhere ask `getWriteOutcome({ writeId })` with `meta.writeId` before writing again; never retry a write blindly. The store's docs say what each `meta.reason` asks of the app.",
			docs: `${CORE_DOCS_URL}/api/project#a-lost-connection`,
		},
	},
	STORE_KIND_TAKEN: {
		code: 'D1021',
		message: 'This storage type is registered already by another kind',
		explanation: {
			when: '`registerStorageKind({ type, kind })` named a type a kind of another `id` holds already: the first registration in the realm is kept, nothing replaced (the same `id` again does nothing: a module evaluated twice, or another copy of the package). `meta`: `type`, `registered` (the id kept), `asked` (the id refused).',
			fix: 'Register each storage type once, from one package: import the entry that registers it from a single copy, or give the other kind a type of its own.',
			docs: `${CORE_DOCS_URL}/guide/development/implementing-a-store#register-a-storage-kind`,
		},
	},

	// D2xxx — Element lookup
	ELEMENT_NOT_FOUND: {
		code: 'D2001',
		message: 'Element not found',
		explanation: {
			when: 'A ref names an element the document does not hold (deleted, never created, or from another document).',
			fix: 'Read the ref from a query in the same document (`getRecord`, `findDescendants`) instead of keeping an old one.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	ROOT_NOT_FOUND: {
		code: 'D2002',
		message: 'Root element not found',
		explanation: {
			when: "The document holds no root element of the dialecte's root tag (an empty or foreign document).",
			fix: "Import a file whose root is the dialecte's root element, or create the document with `project.initEmptyDocument`.",
			docs: `${CORE_DOCS_URL}/api/project#initemptydocument`,
		},
	},
	DUPLICATE_ID: {
		code: 'D2003',
		message: 'Duplicate element ID',
		explanation: {
			when: 'Not raised by core itself: a dialecte or app code raises it when two elements carry the same id.',
			fix: 'Give each element its own id; let core mint them.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	ELEMENT_TAGNAME_MISMATCH: {
		code: 'D2004',
		message: 'Element tagName does not match the expected type',
		explanation: {
			when: "A ref's `tagName` is not the tag of the record its id names.",
			fix: 'Build refs with `toRef(record)` from a record you read, never by hand with a guessed tag.',
			docs: `${CORE_DOCS_URL}/api/transaction#reforrecord`,
		},
	},

	// D3xxx — Constraint violations
	INVALID_PARENT_CHILD: {
		code: 'D3001',
		message: 'Invalid parent-child relationship',
		explanation: {
			when: 'Not raised by core itself: a dialecte or app code raises it when an element is placed under a parent the schema does not admit.',
			fix: "Read the parent's children in the definition (`query.getDefinition`) and add the element under an admitted parent.",
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	INVALID_ATTRIBUTE: {
		code: 'D3002',
		message: 'Invalid attribute for element',
		explanation: {
			when: 'Not raised by core itself: a dialecte or app code raises it for an attribute the element does not declare.',
			fix: "Use an attribute the element's definition lists.",
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	PROTECTED_ROOT: {
		code: 'D3003',
		message: 'Root element cannot be deleted',
		explanation: {
			when: "A transaction tried to delete the document's root element.",
			fix: "Delete the root's children instead, or remove the whole document with `project.removeDocument`.",
			docs: `${CORE_DOCS_URL}/api/transaction#delete`,
		},
	},
	REQUIRED_ATTRIBUTE_MISSING: {
		code: 'D3004',
		message: 'Required attribute is missing',
		explanation: {
			when: 'Not raised by core itself: a dialecte or app code raises it when a required attribute is absent.',
			fix: 'Give the attribute a value when creating the element.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	UNIQUE_CONSTRAINT_VIOLATION: {
		code: 'D3005',
		message: 'Value is already used within its scope',
		explanation: {
			when: 'Not raised by core itself: a dialecte raises it when a value is already used within the scope where it must be unique.',
			fix: "Pick another value, or let the dialecte's hook name the element.",
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	UNKNOWN_NAMESPACE_PREFIX: {
		code: 'D3006',
		message:
			'Unknown namespace prefix on attribute — pass it explicitly as { name, namespace: { prefix, uri } }',
		explanation: {
			when: 'An attribute was written with a namespace key or prefix the dialecte does not declare.',
			fix: "Use a namespace key of the dialecte's config, or pass the namespace in full: `{ name, namespace: { prefix, uri } }`.",
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	PREFIXED_ATTRIBUTE_NAME: {
		code: 'D3007',
		message:
			'Authored attribute name must be a local name — pass the namespace separately as { name, namespace }, not a prefixed name',
		explanation: {
			when: 'An attribute was written with a prefixed name (`ext:attr`) on create or update.',
			fix: "Pass the local name and the namespace apart: `{ name: 'attr', namespace }`.",
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	FIXED_VALUE_VIOLATION: {
		code: 'D3008',
		message: 'Attribute value differs from the schema-fixed value',
		explanation: {
			when: 'A write gave an attribute another value than the one the schema fixes.',
			fix: 'Leave the attribute out (core writes the fixed value) or give exactly the fixed value; `getAttributeRules` reads it.',
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	XSI_TYPE_REQUIRED: {
		code: 'D3009',
		message: 'The element is declared with an abstract type: name a type with xsi:type',
		explanation: {
			when: 'An element declared with an abstract type was created without naming a concrete type in `xsi:type`.',
			fix: "Name one of the admitted types: `attributes: { 'xsi:type': '<Type>' }`; `admittedXsiTypes` lists them.",
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	XSI_TYPE_NOT_ADMITTED: {
		code: 'D3010',
		message: 'The element may not take the type named with xsi:type',
		explanation: {
			when: 'A write named in `xsi:type` a type the element may not take.',
			fix: 'Pick a type from `admittedXsiTypes` for that element.',
			docs: `${CORE_DOCS_URL}/api/transaction#addchild`,
		},
	},
	XSI_TYPE_CHANGE_LEAVES_CONTENT: {
		code: 'D3011',
		message: 'The new xsi:type does not admit content the element still holds',
		explanation: {
			when: 'An update changed `xsi:type` to a type that does not admit attributes or children the element still holds.',
			fix: 'Remove that content in the same transaction before changing the type, or pick a type that admits it.',
			docs: `${CORE_DOCS_URL}/api/transaction#update`,
		},
	},
	XML_CHARACTER_NOT_ALLOWED: {
		code: 'D3012',
		message: 'The text holds a character XML does not allow',
		explanation: {
			when: "A write, an import session's own writes or an export met a character XML does not allow (a control character below U+0020 but tab, line feed and carriage return, U+FFFE, U+FFFF) in a value, a name, a prefix, a namespace URI or an id; nothing was written, no file.",
			fix: 'Remove or replace the character named in `meta.character` at `meta.part` of the record `meta.recordId` before writing or exporting it.',
			docs: `${CORE_DOCS_URL}/io/#values-a-store-keeps`,
		},
	},

	// D4xxx — Transaction lifecycle
	ALREADY_COMMITTED: {
		code: 'D4001',
		message: 'Transaction already committed',
		explanation: {
			when: 'Not raised by core today: kept for a transaction used after its commit.',
			fix: 'Start a new `doc.transaction` for further writes.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	ALREADY_FAILED: {
		code: 'D4002',
		message: 'Transaction already failed',
		explanation: {
			when: 'Not raised by core today: kept for a transaction used after it failed.',
			fix: 'Start a new `doc.transaction`; the failed one wrote nothing.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	DATABASE_COMMIT_ERROR: {
		code: 'D4003',
		message: 'An error occurred while committing changes to the database',
		explanation: {
			when: 'Not raised by core today: store commit failures are `STORE_COMMIT_FAILED`.',
			fix: 'Read `cause`; see `STORE_COMMIT_FAILED`.',
			docs: `${CORE_DOCS_URL}/guide/development/state-and-errors#error-catalog`,
		},
	},
	CONCURRENT_TRANSACTION: {
		code: 'D4004',
		message:
			'A transaction is already in progress. Concurrent transactions are not supported yet — serialize them or implement a transaction queue.',
		explanation: {
			when: 'A `doc.transaction` started on a Document while another transaction or `doc.prepare` was still running on it (a missing `await`, or a nested transaction).',
			fix: 'Await each transaction before the next; inside a transaction, write through its `tx`, never through `doc.transaction` again.',
			docs: `${CORE_DOCS_URL}/api/document`,
		},
	},

	// D5xxx — Import/Export
	EXPORT_ROOT_NOT_FOUND: {
		code: 'D5001',
		message: 'Root element not found in records during export',
		explanation: {
			when: 'The export found no root record in the document.',
			fix: 'The document is empty or damaged: import it again, or create it with `project.initEmptyDocument`.',
			docs: `${CORE_DOCS_URL}/api/project#export`,
		},
	},
	EXPORT_ORPHAN_CHILD_REF: {
		code: 'D5002',
		message: 'Parent references non-existent child record',
		explanation: {
			when: 'The export met a parent whose list of children names a record that does not exist.',
			fix: "A hook or a raw write left a dangling child ref: a hook that deletes must also return the parent's `updated` operation.",
			docs: `${CORE_DOCS_URL}/api/project#export`,
		},
	},
	PARSE_ERROR: {
		code: 'D5003',
		message: 'Failed to parse XML',
		explanation: {
			when: 'The file given to import (or to `parseXmlDocument`) is not well-formed XML.',
			fix: "Fix the XML where `detail` points (line and column); check the file's encoding.",
			docs: `${CORE_DOCS_URL}/api/project#import`,
		},
	},
	IMPORT_FAILED: {
		code: 'D5004',
		message: 'Failed to import the file',
		explanation: {
			when: 'Importing a file failed after it was parsed (a hook threw, the store refused the records); nothing of the file remains.',
			fix: 'Read `cause` and `detail`; an import hook must not read the store or throw on data it can report as a diagnostic.',
			docs: `${CORE_DOCS_URL}/api/project#import`,
		},
	},
	IMPORT_ABORTED: {
		code: 'D5005',
		message: 'The import was aborted',
		explanation: {
			when: "The import's `signal` was aborted; nothing of the file remains.",
			fix: 'Nothing to fix when the abort was wanted; import the file again otherwise.',
			docs: `${CORE_DOCS_URL}/api/project#import`,
		},
	},
	EXPORT_CONFLICT: {
		code: 'D5006',
		message: 'The document changed while it was exported',
		explanation: {
			when: 'The document was written twice while it was being exported, so no consistent file could be read.',
			fix: 'Export when no transaction or import is writing the document, or retry.',
			docs: `${CORE_DOCS_URL}/api/project#export`,
		},
	},
	EXPORT_ABORTED: {
		code: 'D5007',
		message: 'The export was aborted',
		explanation: {
			when: "The export's `signal` was aborted.",
			fix: 'Nothing to fix when the abort was wanted; export again otherwise.',
			docs: `${CORE_DOCS_URL}/api/project#export`,
		},
	},

	// D6xxx — Config
	EXTENSION_METHOD_COLLISION: {
		code: 'D6001',
		message: 'Extension method name collision detected',
		explanation: {
			when: 'Two extension modules merged under one key define a method of the same name.',
			fix: 'Rename your method, or put your module under a key of its own.',
			docs: `${CORE_DOCS_URL}/guide/extensions/#registering-extensions`,
		},
	},

	// D7xxx — Project
	UNKNOWN_CONFIG_KEY: {
		code: 'D7001',
		message: 'Unknown config key',
		explanation: {
			when: 'A document, a test or a declaration named a config key the dialecte does not declare.',
			fix: "Use a key of the dialecte's `configs` (its `defaultConfigKey` when in doubt).",
			docs: `${CORE_DOCS_URL}/api/dialecte#definedialecte`,
		},
	},
	DOCUMENT_NOT_REGISTERED: {
		code: 'D7002',
		message: 'Document not registered in project',
		explanation: {
			when: 'A document id names no document of the open project (removed, or from another project).',
			fix: 'Use an id from `project.getDocuments()` or from the import result.',
			docs: `${CORE_DOCS_URL}/api/project#document-access`,
		},
	},
	PROJECT_NOT_OPENED: {
		code: 'D7003',
		message: 'Project not opened',
		explanation: {
			when: "The project was used before `open(name)` resolved, or once `close()`, `destroy()` or another `open()` was called on it - a batch import's file whose turn came after that is refused the same.",
			fix: 'Keep the instance and await its `open(name)` before using the project; open it again after `close()` or `destroy()`, and await an `open()` of another project before using the Project again.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	BLOB_NOT_FOUND: {
		code: 'D7004',
		message: 'Blob not found in store',
		explanation: {
			when: '`project.exportBlob` named a blob the project does not hold.',
			fix: 'Use an id from `project.getBlobsByDocument` or `getStandaloneBlobs`.',
			docs: `${CORE_DOCS_URL}/api/project#blobs`,
		},
	},
	PROJECT_DIALECTE_MISMATCH: {
		code: 'D7008',
		message: "The project's data is of another dialecte",
		explanation: {
			when: "A project stored by another dialecte was opened (nothing of it written), or what serves the store (a worker, a server) was asked for a project of a dialecte it does not serve. Two dialectes' projects of one name are two projects: opening one never meets the other. `meta`: `project`, `realmDialecteId` (the one asked), and `projectDialecteId` (the project's), or the dialectes served, as the store's docs name them.",
			fix: "Open the project with the dialecte it was created with; serve every dialecte the app opens projects of, as the store's docs say.",
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	PROJECT_DIALECTE_VERSION_MISMATCH: {
		code: 'D7009',
		message: "The project's store runs another version of the dialecte",
		explanation: {
			when: "What serves the project's store (a worker, a server) runs another version of the dialecte than this view: another tab's, or one this page runs already for the project (a page runs one version of each dialecte).",
			fix: 'Reload every tab of the app so they run the same version.',
			docs: `${CORE_DOCS_URL}/api/project#store-errors`,
		},
	},
	PROJECT_DESTROY_FAILED: {
		code: 'D7010',
		message: 'The project could not be deleted',
		explanation: {
			when: 'Destroying a project left its data in place: another tab, window or connection still holds it.',
			fix: 'Close the other tabs or windows of the app that have the project open, then destroy it again.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	PROJECT_OPEN_ELSEWHERE: {
		code: 'D7011',
		message: 'The project is open in another tab, window or connection',
		explanation: {
			when: 'Another tab or window has the project open and there is no shared connection between them; or a destroy was asked while another connection - a store or project of the name in this page, or another tab - has the project open (`meta.connections`, where the store counts them).',
			fix: 'Close the project in the other tab, window or connection, then open or destroy it here again.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	PROJECT_DESTROYED_WHILE_AWAY: {
		code: 'D7013',
		message: 'The project was deleted while this view was away',
		explanation: {
			when: "A view's connection to a project came back - the page back from a freeze or the back/forward cache, what serves its store started again - and the project it had open was destroyed meanwhile by another tab (and maybe made again under its name): nothing is opened in its place and nothing of it is read. `meta.project` names the project.",
			fix: 'Tell the user the project was deleted elsewhere; close it in this view (`project.close()`), then open it again by its name for what is there now, or choose another.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	PROJECT_NAME_INVALID: {
		code: 'D7014',
		message: "The project's name cannot name its files",
		explanation: {
			when: "A project's name or its dialecte's id is empty, `.` or `..`: every store refuses it before it is built (a store may name its files after both, which no file can be); nothing was opened or written. `meta.project` and `meta.dialecteId` say which.",
			fix: 'Give the project a name of its own (and the dialecte an id) other than an empty one, `.` or `..`.',
			docs: `${CORE_DOCS_URL}/api/project#lifecycle`,
		},
	},
	PROJECT_STORAGE_NOT_REGISTERED: {
		code: 'D7018',
		message: "The project's storage type is not registered",
		explanation: {
			when: 'A project was opened (or destroyed by name), or a test asked for a test store, on a `storage.type` no kind is registered for in this realm: core serves `local`, `inMemory` and `custom` itself, every other type comes from the entry that registers it (`registerStorageKind`). Nothing was opened. `meta`: `project`, `type`.',
			fix: "Import the entry that registers the type once in the app's entry (for tests, in the test runner's setup file), before the first project opens on it; or open the project on another storage. Imported already? A kind is shared by every copy of @dialecte/core of the same storage version in the realm: one registered by a copy of another version (a package bringing its own core) is not seen - align the core versions.",
			docs: `${CORE_DOCS_URL}/guide/development/implementing-a-store#register-a-storage-kind`,
		},
	},
	DOCUMENT_PATH_INVALID: {
		code: 'D7030',
		message: "A document's path is not valid",
		explanation: {
			when: "A document's path breaks a rule (empty, `.` or `..` segment, backslash, invisible character, not NFC, too long), names another file than the document's, changes its extension, or was handed to `project.import` of several files; nothing was written. `detail` says which rule.",
			fix: "Write the path relative, joined by `/`, in NFC, ending with the document's file name; pass a path to `importFile`, not to `import`.",
			docs: `${CORE_DOCS_URL}/api/project#a-document-s-path`,
		},
	},
	DOCUMENT_PATH_TAKEN: {
		code: 'D7031',
		message: "A document's path is another document's place",
		explanation: {
			when: "Another document already holds the place (`meta.takenBy`), a document still importing included: the same path, a path under another document's file, or a file at a folder another document's path uses.",
			fix: 'Choose a path no other document holds, or move the other document first.',
			docs: `${CORE_DOCS_URL}/api/project#a-document-s-path`,
		},
	},
} as const
