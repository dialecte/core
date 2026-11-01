import { describe, expect, it } from 'vitest'

import { defineDialecte } from '@/dialecte'
import {
	createTestProject,
	TEST_CONFIG_KEY,
	TEST_DIALECTE_CONFIG,
	XMLNS_DEFAULT_NAMESPACE,
	XMLNS_DEV_NAMESPACE,
} from '@/test'

import type { ImportDocumentOptions, InitEmptyDocumentOptions } from '@/project/types'
import type { TestDialecteConfig } from '@/test'
import type { IOConfig } from '@/types'

// Every dialecte reads `.xml`, besides the extensions its config lists; what core writes stays the first listed.

const namespaceDeclarations = `${XMLNS_DEFAULT_NAMESPACE} ${XMLNS_DEV_NAMESPACE}`
const ROOT_XML = /* xml */ `<Root ${namespaceDeclarations}><A aA="one"/></Root>`

/** Core's test config, its `io` any list of extensions instead of its literal `['.xml']`. */
type ConfigReadingExtensions = Omit<TestDialecteConfig, 'io'> & { io: IOConfig }

/** Core's test config reading the extensions given, in that order, and no other. */
function configReading(params: { extensions: string[] }): ConfigReadingExtensions {
	const io: IOConfig = { supportedFileExtensions: params.extensions }
	return { ...TEST_DIALECTE_CONFIG, io }
}

/**
 * Core's test dialecte (`.xml`, the default config, so its test projects open at any state of the rule) with a
 * config `alt` reading `.alt` only, a config `upper` reading `.XML` only and a config `none` reading no extension.
 */
const XML_DEFAULT_DIALECTE = defineDialecte({
	id: 'core/test-xml-always-read',
	version: '0.0.0',
	configs: {
		[TEST_CONFIG_KEY]: TEST_DIALECTE_CONFIG,
		alt: configReading({ extensions: ['.alt'] }),
		upper: configReading({ extensions: ['.XML'] }),
		none: configReading({ extensions: [] }),
	},
	defaultConfigKey: TEST_CONFIG_KEY,
})

/** A dialecte whose default config reads `.alt` only: its test fixtures are `source.xml` / `target.xml`. */
const ALT_DEFAULT_DIALECTE = defineDialecte({
	id: 'core/test-alt-default',
	version: '0.0.0',
	configs: { [TEST_CONFIG_KEY]: configReading({ extensions: ['.alt'] }) },
	defaultConfigKey: TEST_CONFIG_KEY,
})

type DocumentFile = { name: string; extension: string }

/** A test project of `XML_DEFAULT_DIALECTE`, destroyed when the test ends. */
async function openXmlDefaultProject() {
	const { project } = await createTestProject({
		dialecte: XML_DEFAULT_DIALECTE,
		sourceXml: ROOT_XML,
	})
	return project
}

/** The name and extension of the document a file named `fileName` becomes, imported with `options`. */
async function importedFileOf(params: {
	fileName: string
	options: ImportDocumentOptions
}): Promise<DocumentFile> {
	const { fileName, options } = params
	const project = await openXmlDefaultProject()
	const file = new File([ROOT_XML], fileName, { type: 'text/xml' })
	const { documentId } = await project.importFile(file, options)
	const document = await project.getDocument(documentId)
	return { name: String(document?.name), extension: String(document?.extension) }
}

/** The import of a file named `fileName` with `options`, settled: its rejection is the caller's to assert. */
async function importing(params: {
	fileName: string
	options: ImportDocumentOptions
}): Promise<unknown> {
	const { fileName, options } = params
	const project = await openXmlDefaultProject()
	const file = new File([ROOT_XML], fileName, { type: 'text/xml' })
	return project.importFile(file, options)
}

/** The name and extension of a new empty document made with `options`. */
async function emptyDocumentFileOf(params: {
	options: InitEmptyDocumentOptions
}): Promise<DocumentFile> {
	const project = await openXmlDefaultProject()
	const documentId = await project.initEmptyDocument(params.options)
	const document = await project.getDocument(documentId)
	return { name: String(document?.name), extension: String(document?.extension) }
}

describe('import - `.xml` read besides the config’s extensions', () => {
	type TestCase = {
		description: string
		fileName: string
		options: ImportDocumentOptions
		expected: DocumentFile
	}

	const testCases: TestCase[] = [
		{
			description: 'a config reading `.alt` only, a file `plant.xml` → accepted, `plant` `.xml`',
			fileName: 'plant.xml',
			options: { configKey: 'alt' },
			expected: { name: 'plant', extension: '.xml' },
		},
		{
			description:
				'a config reading `.alt` only, a file `plant.alt` → accepted, `plant` `.alt` (unchanged)',
			fileName: 'plant.alt',
			options: { configKey: 'alt' },
			expected: { name: 'plant', extension: '.alt' },
		},
		{
			description:
				'a config reading `.alt` only, `path: north/plant.xml` → accepted, `plant` `.xml`',
			fileName: 'plant.alt',
			options: { configKey: 'alt', path: 'north/plant.xml' },
			expected: { name: 'plant', extension: '.xml' },
		},
		{
			description:
				'a config reading `.alt` only, a file `plant.XML` → accepted, `plant` `.XML` (its case kept)',
			fileName: 'plant.XML',
			options: { configKey: 'alt' },
			expected: { name: 'plant', extension: '.XML' },
		},
		{
			description:
				'a config reading `.alt` only, `path: north/plant.XML` → accepted, `plant` `.XML` (its case kept)',
			fileName: 'plant.alt',
			options: { configKey: 'alt', path: 'north/plant.XML' },
			expected: { name: 'plant', extension: '.XML' },
		},
		{
			description: 'a config reading `.XML` only, a file `plant.xml` → accepted, `plant` `.xml`',
			fileName: 'plant.xml',
			options: { configKey: 'upper' },
			expected: { name: 'plant', extension: '.xml' },
		},
		{
			description: 'a config reading no extension, a file `plant.xml` → accepted, `plant` `.xml`',
			fileName: 'plant.xml',
			options: { configKey: 'none' },
			expected: { name: 'plant', extension: '.xml' },
		},
		{
			description:
				"core's `.xml` config, a file `plant.xml` → accepted, `plant` `.xml` (unchanged)",
			fileName: 'plant.xml',
			options: {},
			expected: { name: 'plant', extension: '.xml' },
		},
	]

	for (const { description, fileName, options, expected } of testCases) {
		it(description, async () => {
			await expect(importedFileOf({ fileName, options })).resolves.toEqual(expected)
		})
	}
})

describe('import - an extension no config reads still refused', () => {
	type TestCase = {
		description: string
		fileName: string
		options: ImportDocumentOptions
		expected: { key: string; message: string | RegExp }
	}

	const testCases: TestCase[] = [
		{
			description:
				'a config reading `.alt` only, a file `plant.scd` → `Unsupported file type: plant.scd`',
			fileName: 'plant.scd',
			options: { configKey: 'alt' },
			expected: { key: 'ASSERTION_FAILED', message: 'Unsupported file type: plant.scd' },
		},
		{
			description:
				'a config reading `.alt` only, `path: north/plant.scd` → DOCUMENT_PATH_INVALID, its list `.alt, .xml`',
			fileName: 'plant.alt',
			options: { configKey: 'alt', path: 'north/plant.scd' },
			expected: {
				key: 'DOCUMENT_PATH_INVALID',
				message: /north\/plant\.scd.*reads \(\.alt, \.xml\)$/,
			},
		},
		{
			description:
				"core's `.xml` config, `path: north/plant.scd` → DOCUMENT_PATH_INVALID, its list naming `.xml` once",
			fileName: 'plant.xml',
			options: { path: 'north/plant.scd' },
			expected: { key: 'DOCUMENT_PATH_INVALID', message: /reads \(\.xml\)$/ },
		},
	]

	for (const { description, fileName, options, expected } of testCases) {
		it(description, async () => {
			const refused = importing({ fileName, options })
			await expect(refused).rejects.toMatchObject({ cause: { key: expected.key } })
			await expect(refused).rejects.toThrow(expected.message)
		})
	}
})

describe('initEmptyDocument - `.xml` read in a path, the first listed extension written', () => {
	type TestCase = {
		description: string
		options: InitEmptyDocumentOptions
		expected: DocumentFile
	}

	const testCases: TestCase[] = [
		{
			description: 'a config reading `.alt` only, `path: north/new.xml` → accepted, `new` `.xml`',
			options: { configKey: 'alt', path: 'north/new.xml' },
			expected: { name: 'new', extension: '.xml' },
		},
		{
			description:
				'a config reading `.alt` only, no path → `untitled` `.alt` (the first listed, unchanged)',
			options: { configKey: 'alt' },
			expected: { name: 'untitled', extension: '.alt' },
		},
		{
			description: 'a config reading no extension, no path → `untitled` `.xml` (the first read)',
			options: { configKey: 'none' },
			expected: { name: 'untitled', extension: '.xml' },
		},
	]

	for (const { description, options, expected } of testCases) {
		it(description, async () => {
			await expect(emptyDocumentFileOf({ options })).resolves.toEqual(expected)
		})
	}

	it('a config reading `.alt` only, `path: north/new.scd` → DOCUMENT_PATH_INVALID', async () => {
		const refused = emptyDocumentFileOf({ options: { configKey: 'alt', path: 'north/new.scd' } })
		await expect(refused).rejects.toMatchObject({ cause: { key: 'DOCUMENT_PATH_INVALID' } })
		await expect(refused).rejects.toThrow('north/new.scd')
	})
})

describe('createTestProject - a dialecte whose default config reads `.alt` only', () => {
	/** The documents of a test project with a source and a target, as the test helpers import them. */
	async function testProjectFilesOf(): Promise<{ source: DocumentFile; target: DocumentFile }> {
		const { project, source, target } = await createTestProject({
			dialecte: ALT_DEFAULT_DIALECTE,
			sourceXml: ROOT_XML,
			targetXml: ROOT_XML,
		})
		const sourceDocument = await project.getDocument(source.documentId)
		const targetDocument = await project.getDocument(String(target?.documentId))
		return {
			source: { name: String(sourceDocument?.name), extension: String(sourceDocument?.extension) },
			target: { name: String(targetDocument?.name), extension: String(targetDocument?.extension) },
		}
	}

	it('a source and a target → `source.xml` and `target.xml` imported', async () => {
		await expect(testProjectFilesOf()).resolves.toEqual({
			source: { name: 'source', extension: '.xml' },
			target: { name: 'target', extension: '.xml' },
		})
	})
})
