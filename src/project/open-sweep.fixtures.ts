import { TEST_DIALECTE_CONFIG } from '@/test'

import type { DocumentRecord } from './types'
import type { AnyDialecteConfig, AnyRawRecord } from '@/types'

/** A document row under the default config, written by the import `write-<id>`. */
export function document(params: { id: string; status: DocumentRecord['status'] }): DocumentRecord {
	const { id, status } = params
	return {
		id,
		name: id,
		extension: '.xml',
		configKey: 'default',
		createdAt: 1,
		status,
		writeId: `write-${id}`,
	}
}

/** The root record of a document, in the default namespace of core's test dialecte. */
export function root(params: { documentId: string }): AnyRawRecord {
	const { documentId } = params
	const config = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
	return {
		id: `${documentId}-root`,
		tagName: 'Root',
		namespace: config.namespaces.default,
		value: '',
		attributes: [],
		parent: null,
		children: [],
	}
}
