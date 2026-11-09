/** A project of the vitest config, as the guards read it. */
export type ConfiguredProject = {
	name: string
	environment?: string
	include: string[]
	setupFiles: string[]
	/** The variables the project gives its tests (`test.env`). */
	env: Record<string, string>
	/** The values the project provides its tests (`test.provide`, read with `inject`). */
	provide: Record<string, unknown>
}
