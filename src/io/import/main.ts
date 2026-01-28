import { createDatabaseInstance } from '@/database'

import { bulkAddRecords } from './database-helpers'
import { setSaxParser } from './parser'
import { resolveCurrentBatchChildrenRelationships } from './relationships'

import type { ParserInstance } from './types'
import type { AnyDatabaseInstance } from '@/database'
import type { AnyDialecteConfig, ImportOptions, ChunkOptions } from '@/types'

const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
	useBrowserApi: true,
	chunkSize: 32 * 1024, // 32KB
	batchSize: 2000,
}

export async function importXmlFiles(params: {
	files: File[]
	dialecteConfig: AnyDialecteConfig
	useCustomRecordsIds?: boolean
}): Promise<string[]> {
	const { files, dialecteConfig, useCustomRecordsIds = false } = params

	const databaseNames: string[] = []
	if (files.length === 0) throw new Error('No files provided for import.')

	const { importOptions = DEFAULT_IMPORT_OPTIONS, supportedFileExtensions } = dialecteConfig.io

	const consolidatedOptions = {
		...DEFAULT_IMPORT_OPTIONS,
		...importOptions,
	}

	for (const file of files) {
		if (!isFileSupported({ file, supportedExtensions: supportedFileExtensions })) {
			console.error(`Unsupported file type: ${file.name}`)
			continue
		}

		if (file.size === 0) console.warn(`File is empty: ${file.name}`)

		const databaseName = await handleFileImport({
			file,
			dialecteConfig,
			options: consolidatedOptions,
			useCustomRecordsIds,
		})

		databaseNames.push(databaseName)
	}

	return databaseNames
}

/**
 * Validates if a file is supported for import
 */
export function isFileSupported(params: {
	file: File
	supportedExtensions: readonly string[]
}): boolean {
	const { file, supportedExtensions } = params
	return supportedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))
}

export function getDatabaseName(file: File): string {
	return file.name.replace(/\.[^.]+$/, '')
}

async function handleFileImport(params: {
	file: File
	dialecteConfig: AnyDialecteConfig
	options: ImportOptions
	useCustomRecordsIds: boolean
}) {
	const { file, dialecteConfig, options, useCustomRecordsIds } = params

	const databaseName = getDatabaseName(file)
	const databaseInstance = await createDatabaseInstance({ databaseName, dialecteConfig })

	try {
		const elementsTableName = dialecteConfig.database.tables.xmlElements.name
		await databaseInstance.table(elementsTableName).clear()

		if (options.useBrowserApi && file.size !== 0) {
			await processXmlWithBrowserApi({
				file,
				databaseInstance,
				elementsTableName,
				dialecteConfig,
				options: {
					useCustomRecordsIds,
					chunkSize: options.chunkSize,
					batchSize: options.batchSize,
				},
			})
		}

		return databaseName
	} catch (error) {
		console.error(`Error importing file ${file.name}:`, error)
		throw error
	} finally {
		databaseInstance.close()
	}
}

async function processXmlWithBrowserApi(params: {
	file: File
	databaseInstance: AnyDatabaseInstance
	elementsTableName: string
	dialecteConfig: AnyDialecteConfig
	options: ChunkOptions & { useCustomRecordsIds: boolean }
}): Promise<void> {
	const { file, databaseInstance, elementsTableName, dialecteConfig, options } = params

	const reader = file.stream().getReader()

	const sax = setSaxParser({
		dialecteConfig,
		useCustomRecordsIds: options.useCustomRecordsIds,
	})

	const textDecoder = new TextDecoder()
	const buffer = new Uint8Array(0)
	return await createChunks({
		databaseInstance,
		elementsTableName,
		reader,
		sax,
		textDecoder,
		buffer,
		options,
	})
}

async function createChunks(params: {
	databaseInstance: AnyDatabaseInstance
	elementsTableName: string
	reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>
	sax: ParserInstance
	textDecoder: TextDecoder
	buffer: Uint8Array
	options: ChunkOptions
}): Promise<void> {
	const { databaseInstance, elementsTableName, reader, sax, textDecoder, buffer, options } = params
	const { chunkSize, batchSize } = options

	const { done, value } = await reader.read()

	if (done) {
		// If there's any remaining data in the buffer, send it
		if (buffer.length > 0) {
			const chunk = textDecoder.decode(buffer)
			sax.parser.write(chunk)
		}

		sax.parser.close()

		return await checkBatchSizeAndAddRecordsIfNeeded({
			databaseInstance,
			elementsTableName,
			sax,
			batchSize: 0,
		})
	}

	// If value is null or undefined, skip this chunk
	if (!value) {
		return await createChunks(params)
	}

	// Append new data to buffer
	let newBuffer = new Uint8Array(buffer.length + value.length)
	newBuffer.set(buffer)
	newBuffer.set(value, buffer.length)

	// Process full chunks
	while (newBuffer.length >= chunkSize) {
		const chunkBuffer = newBuffer.slice(0, chunkSize)
		newBuffer = newBuffer.slice(chunkSize)

		const chunk = textDecoder.decode(chunkBuffer, { stream: true })
		sax.parser.write(chunk)

		await checkBatchSizeAndAddRecordsIfNeeded({
			databaseInstance,
			elementsTableName,
			sax,
			batchSize,
		})
	}

	// Continue pumping
	return await createChunks({ ...params, buffer: newBuffer })
}

async function checkBatchSizeAndAddRecordsIfNeeded(params: {
	databaseInstance: AnyDatabaseInstance
	elementsTableName: string
	sax: ParserInstance
	batchSize: number
}): Promise<void> {
	const { databaseInstance, elementsTableName, sax, batchSize } = params

	const shouldAddRecords = sax.getSize() >= batchSize

	if (shouldAddRecords) {
		const currentBatch = sax.drainBatch()
		const elementsBatchWithResolvedRelationships = resolveCurrentBatchChildrenRelationships({
			currentBatch: currentBatch,
		})

		await bulkAddRecords({
			databaseInstance,
			elementsTableName,
			records: elementsBatchWithResolvedRelationships,
		})
	}
}
