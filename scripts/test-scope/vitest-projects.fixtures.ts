import vitestConfig from '../../vitest.config'

import type { ConfiguredProject } from './vitest-projects.fixtures.types'

/** The projects of the package's vitest config, as the guards read them. */
export function configuredProjects(): ConfiguredProject[] {
	const projects = (vitestConfig.test?.projects ?? []) as { test?: Record<string, unknown> }[]
	return projects.map(function configured(project) {
		const test = project.test ?? {}
		const setupFiles = test.setupFiles
		return {
			name: String(test.name),
			environment: test.environment as string | undefined,
			include: (test.include as string[] | undefined) ?? [],
			setupFiles: typeof setupFiles === 'string' ? [setupFiles] : ((setupFiles as string[]) ?? []),
			env: (test.env as Record<string, string> | undefined) ?? {},
			provide: (test.provide as Record<string, unknown> | undefined) ?? {},
		}
	})
}
