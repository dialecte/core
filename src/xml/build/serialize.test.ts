import { buildXmlDocument } from './build-xml-document'
import { xmlDocumentToString } from './serialize'

import { describe, expect, it } from 'vitest'

import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyRawRecord } from '@/types'

const CONFIG = TEST_DIALECTE_CONFIG

function rootDoc(): XMLDocument {
	const records: AnyRawRecord[] = [
		{
			id: 'root-1',
			tagName: 'Root',
			namespace: CONFIG.namespaces.default,
			value: '',
			attributes: [{ name: 'root', value: '1' }],
			parent: null,
			children: [],
		},
	]
	return buildXmlDocument({ records, config: CONFIG })
}

describe('xmlDocumentToString', () => {
	it('prepends the XML declaration', () => {
		const xml = xmlDocumentToString(rootDoc())
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
	})

	it('serializes the document element', () => {
		const xml = xmlDocumentToString(rootDoc())
		expect(xml).toContain('<Root')
		expect(xml).toContain('root="1"')
	})

	it('produces formatted (multi-line) output', () => {
		const xml = xmlDocumentToString(rootDoc())
		// declaration on its own line, element below
		expect(xml.split('\n').length).toBeGreaterThan(1)
	})

	it('prepends the XML declaration by default (explicit option)', () => {
		const xml = xmlDocumentToString(rootDoc(), { includeXmlDeclaration: true })
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
	})

	it('omits the XML declaration when includeXmlDeclaration is false', () => {
		const xml = xmlDocumentToString(rootDoc(), { includeXmlDeclaration: false })
		expect(xml.startsWith('<?xml')).toBe(false)
		expect(xml).toContain('<Root')
	})
})
