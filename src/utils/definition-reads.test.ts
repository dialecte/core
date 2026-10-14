import { describe, expect, it } from 'vitest'

/**
 * Every reader of the definition goes through `resolveDefinition`, which knows the declaration under the record's
 * parent and the type it names with xsi:type. A read by tag name sees neither; the files that do it say why.
 */
const ALLOWED: Readonly<Record<string, string>> = {
	'/src/utils/resolve-definition.ts': 'the resolver itself',
	'/src/helpers/standardizing.ts':
		'the namespaces any declaration of the tag uses, to keep the one a record was read in',
	'/src/helpers/converter.ts':
		'the namespace an attribute name is declared in - one wherever it appears',
}

const SOURCES = import.meta.glob<string>(['/src/**/*.ts', '!/src/**/*.test.ts', '!/src/test/**'], {
	query: '?raw',
	import: 'default',
	eager: true,
})

describe('definition reads', () => {
	it('only the allowed files read the definition by tag name', () => {
		const reading = Object.entries(SOURCES)
			.filter(([, source]) => /\.definition\[/.test(source))
			.map(([path]) => path)
		expect(reading.sort()).toEqual(Object.keys(ALLOWED).sort())
	})
})
