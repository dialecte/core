/** A module the test-entry scan reads in its own test: non-exported types reached through other type shapes. */
// not re-exported by this module: a consumer of it could not name the types
import type { Box, ShapeRow, Tagged } from './test-entry-scan-shapes.types'

export function indexShapeRows(): { [key: string]: ShapeRow } {
	return {}
}

export function listShapeRowsByNumber(): { [position: number]: ShapeRow } {
	return {}
}

export function pickShapeRow<GenericRow extends ShapeRow>(params: { row: GenericRow }): string {
	return params.row.value
}

export function emptyShapeRows<GenericRow = ShapeRow>(): GenericRow[] {
	return []
}

export function tagShapeRow(): Tagged<ShapeRow> {
	return { label: '' }
}

export function boxShapeRow(): Box<ShapeRow> {
	return { id: '' }
}
