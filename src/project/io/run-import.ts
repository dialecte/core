import { resolveConfig } from './resolve-config'

import { createDialecteError, throwDialecteError, toDialecteError } from '@/errors'
import { createPerf } from '@/perf'
import { readableExtensionsOf, splitFileName } from '@/store/document-path'
import { parseXmlFile } from '@/xml'
import { throwIfAborted } from '@/xml/parse/parse-xml-document'

import type { RunImportParams } from './run-import.types'
import type { Perf } from '@/perf'
import type { DocumentRecord } from '@/project/types'
import type { ImportControl, ImportFileResult } from '@/store/store.types'
import type { AnyDialecteConfig } from '@/types'

/**
 * The import of one file, next to the data - what every store's `importFile` runs. It registers the
 * document `importing` under the caller's `writeId`, parses the file with the dialecte's import
 * session and stores it batch by batch, applies the session's writes, marks the document `ready`.
 * A document is whole or absent: whatever fails, or an abort, removes it and is thrown (a foreign
 * error as `IMPORT_FAILED`, its cause kept; diagnostics that are not plain JSON as
 * `STORE_VALUE_NOT_JSON`). The progress listener and the abort come apart from the import's data, as
 * a worker call carries them.
 *
 * @intent implement importFile of a custom store, import a file into a store with core's import pipeline
 */
export async function runImport(
	params: RunImportParams,
	control: ImportControl = {},
): Promise<ImportFileResult> {
	const { runtime, file, options, writeId } = params
	const perf = params.perf ?? createPerf({ enabled: runtime.perf ?? false, timeline: false })

	throwIfAborted({ signal: control.signal, file })
	const { configKey, config } = resolveConfig({
		configs: runtime.configs,
		defaultConfigKey: runtime.defaultConfigKey,
		configKey: options?.configKey,
	})

	const registered: DocumentRecord = {
		id: crypto.randomUUID(),
		...documentNameOf({ file, path: options?.path, config }),
		configKey,
		createdAt: Date.now(),
		metadata: options?.metadata,
		status: 'importing',
		writeId,
		...(options?.path !== undefined && { path: options.path }),
	}

	perf.start('import')
	let imported: Omit<ImportFileResult, 'perf'>
	try {
		imported = await importRegistered({ ...params, control, registered, config, perf })
	} catch (failure) {
		// structured as thrown; anything else as `IMPORT_FAILED`, the original as its cause
		if (toDialecteError(failure)) throw failure
		throw createDialecteError('IMPORT_FAILED', {
			detail: failure instanceof Error ? failure.message : String(failure),
			cause: failure instanceof Error ? failure : undefined,
		})
	} finally {
		perf.stop('import')
	}
	return { ...imported, ...(runtime.perf && { perf: perf.snapshot() }) }
}

/**
 * The name and extension of the document a file becomes: its path's file name when it is given one (an extension
 * its config reads, `.xml` always among them), else the file's own name (the first extension its config reads when
 * the name has no dot, which only a config entry without a dot lets through).
 */
function documentNameOf(params: {
	file: File
	path: string | undefined
	config: AnyDialecteConfig
}): Pick<DocumentRecord, 'name' | 'extension'> {
	const { file, path, config } = params
	const extensions = readableExtensionsOf({ extensions: config.io.supportedFileExtensions })
	if (path !== undefined) return splitFileName({ path, extensions })
	return {
		name: file.name.replace(/\.[^.]+$/, '') || 'untitled',
		extension: file.name.includes('.') ? `.${file.name.split('.').pop()!}` : extensions[0],
	}
}

/** Register the document, store the file into it and mark it ready; removed again on any failure. */
async function importRegistered(
	params: RunImportParams & {
		control: ImportControl
		registered: DocumentRecord
		config: AnyDialecteConfig
		perf: Perf
	},
): Promise<Omit<ImportFileResult, 'perf'>> {
	const { store, runtime, file, options, control, registered, config, perf } = params

	perf.start('import::register')
	try {
		await store.registerDocument(registered)
	} finally {
		perf.stop('import::register')
	}

	try {
		const parsed = await parseXmlFile(
			{
				file,
				documentId: registered.id,
				configKey: registered.configKey,
				store,
				config,
				useCustomRecordsIds: options?.useCustomRecordsIds,
				chunkOptions: options?.chunkOptions,
				hooks: runtime.hooks,
				perf,
			},
			control,
		)
		throwIfAborted({ signal: control.signal, file })
		perf.start('import::finalize')
		try {
			// a registry row removed meanwhile (by another connection) is never answered ready
			if (!(await store.getDocument(registered.id))) {
				throwDialecteError('DOCUMENT_NOT_REGISTERED', {
					detail: `Document "${registered.id}" of "${file.name}" was removed while it imported`,
					meta: { documentId: registered.id },
				})
			}
			await store.markReady(registered.id)
		} finally {
			perf.stop('import::finalize')
		}
		return {
			record: { ...registered, status: 'ready' },
			recordCount: parsed.recordCount,
			diagnostics: parsed.diagnostics,
		}
	} catch (failure) {
		await removeQuietly({ store, documentId: registered.id })
		throw failure
	}
}

/** Remove what an import left; its own failure is the one to report, so this one is not thrown. */
async function removeQuietly(params: {
	store: RunImportParams['store']
	documentId: string
}): Promise<void> {
	const { store, documentId } = params
	try {
		await store.removeDocument(documentId)
	} catch {
		// a row that survived stays `importing`: the next store start removes it
	}
}
