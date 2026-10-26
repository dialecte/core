import {
	GOLDEN_COMPACT,
	GOLDEN_FORMATTED,
	GOLDEN_LEAF_VALUE,
	GOLDEN_SOURCE_XML,
} from './export-golden.fixtures'

import { describe, expect, it } from 'vitest'

import { createTestProject } from '@/test'

describe('the export writes the bytes the DOM builder wrote', () => {
	it('a document of several namespaces, xsi:type, escapes, schema attributes and CRLF text -> the same bytes', async () => {
		const { project, source } = await createTestProject({ sourceXml: GOLDEN_SOURCE_XML })
		try {
			const [leaf] = await source.document.query.getRecordsByTagName('AAAA_1')
			await source.document.transaction(async function writeValue(tx) {
				await tx.update(leaf!, { value: GOLDEN_LEAF_VALUE })
			})
			const { file: formatted } = await project.export({ documentId: source.documentId })
			const { file: compact } = await project.export({
				documentId: source.documentId,
				indent: false,
			})

			expect(await formatted.text()).toBe(GOLDEN_FORMATTED)
			// the one change: the compact file writes a text value's carriage return as a reference, so a reader keeps it
			expect(await compact.text()).toBe(GOLDEN_COMPACT.replaceAll('\r', '&#13;'))
		} finally {
			await project.destroy()
		}
	})
})
