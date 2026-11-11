import { browserTierOf } from './browser-tier-of'
import { gateSelectionOf } from './gate-selection-of'
import { BROWSER_FILES } from './test-scope.fixtures'

import { describe, expect, it } from 'vitest'

import type { GateScope } from './test-scope.types'

const SCOPE: GateScope = {
	base: 'b'.repeat(40),
	tree: 't'.repeat(40),
	changed: ['src/errors/errors.ts', 'doc/a.md'],
	selectionPath: '/s.json',
}

/** The id rule of the gate's selection file (@dialecte/cli 0.4.0, selection.constants.ts SELECTION_ID_PATTERN). */
const GATE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** The id each browser file is selected under: its file name, without its folder and `.test.ts`. */
const BROWSER_FILE_IDS = BROWSER_FILES.map((path) =>
	path.slice(path.lastIndexOf('/') + 1, -'.test.ts'.length),
)

describe('gateSelectionOf', () => {
	it("each selected browser file under its file name (no folder, no `.test.ts`), with its reasons; the gate's base, tree and changed count", () => {
		expect(
			gateSelectionOf({
				scope: SCOPE,
				selection: {
					tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
					browserFiles: [
						{
							path: 'src/store/sqlite/served/hub/hub-client.test.ts',
							tier: 'T4',
							reasons: ['src/errors/errors.ts changed, in its import closure'],
						},
						{
							path: 'src/utils/save-to-disk.test.ts',
							tier: 'T3',
							reasons: ['src/errors/errors.ts changed (a source file)'],
						},
					],
				},
			}),
		).toEqual({
			schema: 1,
			base: 'b'.repeat(40),
			tree: 't'.repeat(40),
			changed: 2,
			selected: [
				{ id: 'hub-client', reasons: ['src/errors/errors.ts changed, in its import closure'] },
				{ id: 'save-to-disk', reasons: ['src/errors/errors.ts changed (a source file)'] },
			],
			skipped: [],
		})
	})

	it('nothing selected: an empty list, the count still the one the gate handed', () => {
		expect(
			gateSelectionOf({ scope: SCOPE, selection: { tiers: ['T0', 'T1', 'T2'], browserFiles: [] } }),
		).toEqual({
			schema: 1,
			base: 'b'.repeat(40),
			tree: 't'.repeat(40),
			changed: 2,
			selected: [],
			skipped: [],
		})
	})

	it('every browser file selected: each under its own id, in the order of the config', () => {
		expect(
			gateSelectionOf({
				scope: SCOPE,
				selection: {
					tiers: ['T0', 'T1', 'T2', 'T3', 'T4'],
					browserFiles: BROWSER_FILES.map((path) => ({
						path,
						tier: browserTierOf({ path }),
						reasons: ['listed'],
					})),
				},
			}).selected.map((entry) => entry.id),
		).toEqual(BROWSER_FILE_IDS)
	})

	it("every browser file's id is one the gate accepts, and no two files share one", () => {
		expect({
			refused: BROWSER_FILE_IDS.filter((id) => !GATE_ID.test(id)),
			shared: BROWSER_FILE_IDS.filter((id, index) => BROWSER_FILE_IDS.indexOf(id) !== index),
		}).toEqual({ refused: [], shared: [] })
	})
})
