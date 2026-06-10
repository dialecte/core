import * as sax from 'sax'

import { throwDialecteError } from '@/errors'

import type { AnyDialecteConfig, AttributesValueObjectOf, ChildrenOf, ElementsOf } from '@/types'

/**
 * Lightweight XML element inspector.
 *
 * Uses the same SAX streaming pipeline as the IO parser, but breaks early
 * once all requested elements are found. No length limit, no DOM.
 *
 * Element names are matched on local name (namespace prefix stripped).
 * Attribute keys are also local names.
 *
 * @example
 * const report = inspectXml(xml, { elements: ['project', 'Project'] as const })
 * // report.project?.attributes.schemaVersion  → '2.01' | undefined
 * // report.Project?.attributes.schemaVersion  → string | undefined
 */

export type InspectedElement<
	GenericConfig extends AnyDialecteConfig,
	GenericElement extends ElementsOf<GenericConfig>,
> = {
	/** All attributes found on the opening tag, keyed by local name. */
	attributes: Partial<AttributesValueObjectOf<GenericConfig, GenericElement>>
	/** Names of child elements found directly under this element. */
	children: ChildrenOf<GenericConfig, GenericElement>[]
	value: string
}

export type InspectionReport<
	GenericConfig extends AnyDialecteConfig,
	T extends readonly ElementsOf<GenericConfig>[],
> = {
	[K in T[number]]: InspectedElement<GenericConfig, K> | undefined
}

/**
 * Inspect an XML string for the first occurrence of each requested element name.
 * Returns a typed report keyed by the requested names.
 *
 * Streams the input via SAX and stops as soon as all elements are found.
 * Case-sensitive: `'project'` and `'Project'` are distinct entries.
 */
export function inspectXml<
	const GenericConfig extends AnyDialecteConfig = AnyDialecteConfig,
	const GenericElements extends readonly ElementsOf<GenericConfig>[] =
		readonly ElementsOf<GenericConfig>[],
>(
	xml: string,
	params: { config?: GenericConfig; elements: GenericElements },
): Record<string, InspectedElement<GenericConfig, GenericElements[number]> | undefined> {
	const remaining = new Set<string>(params.elements)
	const report: Record<
		string,
		InspectedElement<GenericConfig, GenericElements[number]> | undefined
	> = {}

	for (const name of params.elements) {
		report[name] = undefined
	}

	const parser = sax.parser(true, { xmlns: true, position: false })

	// Track the local name of the last matched open tag to collect its text value.
	let pendingName: string | null = null

	parser.onopentag = (node) => {
		const tag = node as sax.QualifiedTag
		const localName = tag.local

		if (!remaining.has(localName)) return

		const attributes: Record<string, string> = {}
		for (const attribute of Object.values(tag.attributes) as sax.QualifiedAttribute[]) {
			const name = attribute.prefix ? attribute.local : attribute.name
			attributes[name] = attribute.value
		}

		report[localName] = {
			attributes: attributes as Partial<
				AttributesValueObjectOf<GenericConfig, GenericElements[number]>
			>,
			value: '',
			children: [],
		}
		remaining.delete(localName)
		pendingName = localName
	}

	parser.ontext = (text) => {
		if (pendingName && report[pendingName]) {
			report[pendingName]!.value += text
		}
	}

	parser.oncdata = parser.ontext

	parser.onclosetag = (tagName) => {
		if (pendingName === tagName) pendingName = null
		if (remaining.size === 0) throw earlyExit
	}

	try {
		parser.write(xml).close()
	} catch (error) {
		if (error !== earlyExit)
			throwDialecteError('PARSE_ERROR', {
				detail: String(error),
				cause: error instanceof Error ? error : undefined,
			})
	}

	return report
}

// Sentinel object - cheaper than constructing an Error and avoids stack capture.
const earlyExit = Symbol('inspectXml:earlyExit')
