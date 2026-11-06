import type { Diagnostic } from '@/diagnostics'

/** What a case reads of a project of one of the two dialectes: the same members whatever the dialecte's config. */
export type TwoDialectesProject = {
	importFile: (file: File) => Promise<{ documentId: string; diagnostics: Diagnostic[] }>
	getDocuments: () => Promise<readonly { id: string }[]>
	close: () => Promise<void>
}

/** Which of the two dialectes of the `two-dialectes` fixture worker. */
export type TwoDialectesWhich = 'first' | 'second'
