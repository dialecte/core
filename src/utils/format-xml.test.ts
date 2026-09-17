import { formatEmbeddedXml, formatXml } from './format-xml'

import { describe, expect, it } from 'vitest'

// Inputs are double-quoted / array-joined so the literal `${ns}` / `${id}` interpolation markers
// survive as text (a template literal would try to interpolate them).

describe('formatXml', () => {
	it('puts each structural tag on its own line, tab-indented, interpolations preserved', () => {
		const input =
			'<SCL ${ns} ${id}="root"><IED name="A" ${id}="ied"><Server ${id}="srv"></Server></IED></SCL>'
		const expected = [
			'<SCL ${ns} ${id}="root">',
			'\t<IED name="A" ${id}="ied">',
			'\t\t<Server ${id}="srv"></Server>',
			'\t</IED>',
			'</SCL>',
		].join('\n')
		expect(formatXml(input)).toBe(expected)
	})

	it('keeps a text-only leaf inline and self-closing tags on their own line', () => {
		const input = '<a><b name="x" ${id}="b1">hello</b><c ${id}="c1" /></a>'
		const expected = [
			'<a>',
			'\t<b name="x" ${id}="b1">hello</b>',
			'\t<c ${id}="c1" />',
			'</a>',
		].join('\n')
		expect(formatXml(input)).toBe(expected)
	})

	it('treats a bare ${...} interpolation as opaque, never dropping the element', () => {
		// a real XML parser mis-parses `${templateUuid}` (a whole-attribute interpolation) and drops the
		// element; the non-validating reindenter keeps it verbatim.
		const input = '<Bay ${id}="bay"><Function ${id}="fn" uuid="u" ${templateUuid}/></Bay>'
		const expected = [
			'<Bay ${id}="bay">',
			'\t<Function ${id}="fn" uuid="u" ${templateUuid}/>',
			'</Bay>',
		].join('\n')
		expect(formatXml(input)).toBe(expected)
	})

	it('is idempotent', () => {
		const input = '<a ${id}="1"><b ${id}="2"><c ${id}="3">t</c></b></a>'
		const once = formatXml(input)
		expect(formatXml(once)).toBe(once)
	})
})

describe('formatEmbeddedXml', () => {
	it('reformats a /* xml */ template literal, closing backtick aligned with the statement', () => {
		const source = [
			'\tconst sourceXml = /* xml */ `<SCL ${ns}><IED name="A" ${id}="ied"></IED></SCL>`',
			'\tconst other = 42',
		].join('\n')
		const expected = [
			'\tconst sourceXml = /* xml */ `',
			'\t\t<SCL ${ns}>',
			'\t\t\t<IED name="A" ${id}="ied"></IED>',
			'\t\t</SCL>',
			'\t`',
			'\tconst other = 42',
		].join('\n')
		expect(formatEmbeddedXml(source)).toBe(expected)
	})

	it('keeps a trivial single-element snippet inline', () => {
		const source = '\t\tconst empty = /* xml */ `<SCL ${id}="t"></SCL>`'
		expect(formatEmbeddedXml(source)).toBe(source)
	})

	it('is idempotent', () => {
		const source = '\tconst x = /* xml */ `<a ${id}="1"><b ${id}="2"></b></a>`'
		const once = formatEmbeddedXml(source)
		expect(formatEmbeddedXml(once)).toBe(once)
	})
})
