import { XMLNS_NAMESPACE_URI } from '@/helpers'
import { isXsiTypeAttribute } from '@/utils/xsi-type'

import type { JudgeValue, OracleIssue } from './conformance.types'
import type { Document } from '@/document'
import type { TestDialecteConfig } from '@/test'
import type { AnyAttribute, AnyTreeRecord } from '@/types'
import type { FormValueAttribute } from '@/validation'

/**
 * The value scan: every typed attribute and every typed text of every record, through `query.validate.value`.
 * Returns the record ids it refuses with the issue reason (and the attribute for an attribute defect).
 *
 * The records are read once, as one tree; `validate.value` reads each record's parent again (one read per value):
 * acceptable for a test harness; a document-wide engine would judge set-at-a-time. The root has no parent to be judged under:
 * its own values are not scanned.
 */
export async function scanValues(params: {
	document: Document<TestDialecteConfig>
}): Promise<readonly OracleIssue[]> {
	const { document: source } = params
	const root = await source.query.getRoot()
	const tree = await source.query.getTree(root)
	// the records' tag and attribute names are read from the document, not known to the compiler
	const judgeValue = source.query.validate.value.bind(source.query.validate) as JudgeValue
	const issues: OracleIssue[] = []
	const parents: AnyTreeRecord[] = tree === undefined ? [] : [tree as AnyTreeRecord]

	for (let parent = parents.pop(); parent !== undefined; parent = parents.pop()) {
		for (const child of parent.tree) {
			parents.push(child)
			const flagged = await scanRecord({ judgeValue, parent, record: child })
			issues.push(...flagged)
		}
	}
	return issues
}

/**
 * The issues of one record's attributes and text, judged as written under its parent. Its xsi:type first: a type it
 * cannot name leaves the rest of the record unread (no declaration to judge it by), its one issue.
 */
async function scanRecord(params: {
	judgeValue: JudgeValue
	parent: AnyTreeRecord
	record: AnyTreeRecord
}): Promise<OracleIssue[]> {
	const { judgeValue, parent, record } = params
	const xsiTypeAttribute = record.attributes.find(isXsiTypeAttribute)
	const xsiType = xsiTypeAttribute?.value
	if (xsiTypeAttribute !== undefined) {
		const issue = await judgeValue({
			parent,
			tagName: record.tagName,
			attribute: attributeInput(xsiTypeAttribute),
			value: xsiTypeAttribute.value,
		})
		if (issue) return [{ at: record.id, code: issue.reason, attribute: xsiTypeAttribute.name }]
	}
	const issues: OracleIssue[] = []

	for (const attribute of record.attributes) {
		if (attribute === xsiTypeAttribute || isNamespaceDeclaration(attribute)) continue
		const issue = await judgeValue({
			parent,
			tagName: record.tagName,
			xsiType,
			attribute: attributeInput(attribute),
			value: attribute.value,
		})
		if (issue) issues.push({ at: record.id, code: issue.reason, attribute: attribute.name })
	}

	const textIssue = await judgeValue({
		parent,
		tagName: record.tagName,
		xsiType,
		value: record.value,
	})
	if (textIssue) issues.push({ at: record.id, code: textIssue.reason })
	return issues
}

/**
 * A stored attribute as the write path takes it: `{ name, namespace }` with the namespace the record keeps, its name
 * alone when it has none.
 */
function attributeInput(attribute: AnyAttribute): FormValueAttribute {
	const { name, namespace } = attribute
	return namespace === undefined ? name : { name, namespace }
}

/** An `xmlns` or `xmlns:*` binding: a namespace declaration, not a value of the record. */
function isNamespaceDeclaration(attribute: AnyAttribute): boolean {
	if (attribute.name === 'xmlns' || attribute.name.startsWith('xmlns:')) return true
	return attribute.namespace?.uri === XMLNS_NAMESPACE_URI
}
