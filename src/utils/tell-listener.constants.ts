/** What a listener is told of, as the report of its failure names it. */
export const TOLD_OF = {
	importProgress: "an import's progress",
	importedFile: "an imported file's entry",
	exportProgress: "an export's progress",
	commitProgress: "a commit's progress",
	callProgress: "a call's progress",
	engineChanges: "a project engine's changes",
} as const
