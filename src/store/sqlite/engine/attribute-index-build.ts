import {
	buildAttributePair,
	markAttributePairReady,
	registerAttributePair,
} from './attribute-index'

import type { AttributeBuildContext, AttributeIndexBuilder } from './attribute-index.types'

/**
 * The engine's builds of index pairs: a lookup asking pairs not `ready` builds them in the call, in one write -
 * registered (from then on every write keeps their rows), every record of the tag added, marked `ready` - then
 * answers from the index. A build that fails (the file full, an I/O error) is rolled back whole, leaving the file as
 * it was; its pairs are answered by filter and not built again until the engine starts again. Any other failure is
 * thrown.
 */
export function createAttributeIndexBuilder(context: AttributeBuildContext): AttributeIndexBuilder {
	const { db, write, isGivenUp } = context
	const failed = new Set<string>()

	return {
		build: function build({ documentId, tables, tagName, names }) {
			const keys = names.map((name) => JSON.stringify([documentId, tagName, name]))
			if (keys.some((key) => failed.has(key))) return false
			try {
				write(function buildInOneTransaction() {
					for (const name of names) {
						registerAttributePair({ db, tables, tagName, name })
						buildAttributePair({ db, tables, tagName, name })
						markAttributePairReady({ db, tables, tagName, name })
					}
				})
				return true
			} catch (thrown) {
				// a bug (a statement SQLite refuses) is thrown, never hidden behind the filter
				if (!isGivenUp(thrown)) throw thrown
				for (const key of keys) failed.add(key)
				return false
			}
		},
		forget: function forget({ documentId }) {
			for (const key of failed) {
				if (JSON.parse(key)[0] === documentId) failed.delete(key)
			}
		},
	}
}
