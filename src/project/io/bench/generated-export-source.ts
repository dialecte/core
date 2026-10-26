import { GENERATED_ATTRIBUTES, GENERATED_VALUE_EVERY } from './export-bench.constants'

import { resolveDefinition } from '@/utils'

import type { GeneratedShape, GeneratedSource } from './export-bench.types'
import type { DocumentRecord } from '@/project/types'
import type { ExportSource } from '@/store/store.types'
import type { AnyRawRecord } from '@/types'

/**
 * A document made on read, of a fixed shape: `fanOuts[n]` children per element at depth n. With a dialecte config
 * the elements are the config's own (the root element, then each element's children in its sequence, cycled), held
 * with no attribute so the export writes the schema's required and fixed ones; without one they are `L<depth>` tags
 * the config does not know, each with `GENERATED_ATTRIBUTES` attributes. A record id is its path (`r.3.1`): any record
 * is made from its id alone, nothing is held between reads.
 */
export function createGeneratedExportSource(params: {
	shape: GeneratedShape
	documentId: string
}): GeneratedSource {
	const { shape, documentId } = params
	const stats = { getManyCalls: 0, recordsMade: 0, makeMs: 0 }
	const rootTag = rootTagOf({ shape })
	const totalRecords = countRecords({ shape, tagName: rootTag, depth: 0 })
	const document: DocumentRecord = {
		id: documentId,
		name: 'generated',
		extension: '.xml',
		configKey: 'default',
		createdAt: 0,
		status: 'ready',
	}
	const source: ExportSource = {
		getDocument: async function getDocument() {
			return document
		},
		count: async function count() {
			return totalRecords
		},
		getByTagNameInDocument: async function getByTagNameInDocument(tagName) {
			if (tagName !== rootTag) return []
			return [makeRecord({ shape, id: 'r', tagName: rootTag, parent: null })]
		},
		getMany: async function getMany(ids) {
			const startedAt = performance.now()
			stats.getManyCalls++
			stats.recordsMade += ids.length
			const records = ids.map((id) => recordOf({ shape, id, rootTag }))
			stats.makeMs += performance.now() - startedAt
			return records
		},
		getExportVersion: async function getExportVersion() {
			return 0
		},
	}
	return { source, stats, totalRecords }
}

function rootTagOf(params: { shape: GeneratedShape }): string {
	return params.shape.config?.rootElementName ?? 'L0'
}

/** The tags of an element's children, in the order they are made. */
function childTagsOf(params: { shape: GeneratedShape; tagName: string; depth: number }): string[] {
	const { shape, tagName, depth } = params
	const fanOut = shape.fanOuts[depth] ?? 0
	if (!shape.config) return Array.from({ length: fanOut }, () => `L${depth + 1}`)
	const sequence = (shape.config.children as Record<string, readonly string[]>)[tagName] ?? []
	if (sequence.length === 0) return []
	return Array.from({ length: fanOut }, (_, index) => sequence[index % sequence.length]!)
}

function countRecords(params: { shape: GeneratedShape; tagName: string; depth: number }): number {
	const { shape, tagName, depth } = params
	let total = 1
	for (const childTag of childTagsOf({ shape, tagName, depth })) {
		total += countRecords({ shape, tagName: childTag, depth: depth + 1 })
	}
	return total
}

/** The record of an id: its tag found by walking the path from the root. */
function recordOf(params: { shape: GeneratedShape; id: string; rootTag: string }): AnyRawRecord {
	const { shape, id, rootTag } = params
	const path = id.split('.')
	let tagName = rootTag
	let parent: AnyRawRecord['parent'] = null
	for (let depth = 1; depth < path.length; depth++) {
		const parentId = path.slice(0, depth).join('.')
		parent = { id: parentId, tagName }
		tagName = childTagsOf({ shape, tagName, depth: depth - 1 })[Number(path[depth])]!
	}
	return makeRecord({ shape, id, tagName, parent })
}

function makeRecord(params: {
	shape: GeneratedShape
	id: string
	tagName: string
	parent: AnyRawRecord['parent']
}): AnyRawRecord {
	const { shape, id, tagName, parent } = params
	const depth = id.split('.').length - 1
	const children = childTagsOf({ shape, tagName, depth }).map((childTag, index) => ({
		id: `${id}.${index}`,
		tagName: childTag,
	}))
	// a known element is read through the one resolver, under its parent
	const known = shape.config
		? resolveDefinition({
				dialecteConfig: shape.config,
				record: { tagName, parent, attributes: [] },
			})
		: undefined
	const isLeaf = children.length === 0
	const lastIndex = Number(id.split('.').at(-1)) || 0
	return {
		id,
		tagName,
		namespace: known?.namespace ?? shape.namespace,
		attributes: known
			? []
			: Array.from({ length: GENERATED_ATTRIBUTES }, (_, index) => ({
					name: `a${index}`,
					value: `${id}-${index}`.padEnd(36, '0'),
				})),
		value: isLeaf && lastIndex % GENERATED_VALUE_EVERY === 0 ? `value of ${id}` : '',
		parent,
		children,
	}
}
