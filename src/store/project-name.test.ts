import { refuseUnnamableProject } from './project-name'

import { describe, expect, it } from 'vitest'

import { toDialecteError } from '@/errors'

describe('a project’s name and its dialecte’s id', () => {
	type TestCase = { project: string; dialecteId?: string; refused: boolean }
	const testCases: Record<string, TestCase> = {
		'a name of its own → taken': { project: 'north', refused: false },
		'a name of its own, a dialecte id of its own → taken': {
			project: 'north',
			dialecteId: 'core/test',
			refused: false,
		},
		'a name holding a dot → taken': { project: 'north.v2', refused: false },
		'an empty name → refused': { project: '', refused: true },
		'a name `.` → refused': { project: '.', refused: true },
		'a name `..` → refused': { project: '..', refused: true },
		'an empty dialecte id → refused': { project: 'north', dialecteId: '', refused: true },
		'a dialecte id `.` → refused': { project: 'north', dialecteId: '.', refused: true },
		'a dialecte id `..` → refused': { project: 'north', dialecteId: '..', refused: true },
	}
	for (const [description, { project, dialecteId, refused }] of Object.entries(testCases)) {
		it(description, () => {
			const key = (() => {
				try {
					refuseUnnamableProject({ project, dialecteId })
					return undefined
				} catch (thrown) {
					return toDialecteError(thrown)?.key
				}
			})()
			expect(key).toBe(refused ? 'PROJECT_NAME_INVALID' : undefined)
		})
	}
})
