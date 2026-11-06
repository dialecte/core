/** The members the store calls only from inside another call: an import's and an export's abort. */
export const INNER_MEMBERS = ['abortImport', 'abortExport'] as const
