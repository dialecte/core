import { throwDialecteError } from '@/errors'
import { XMLNS_NAMESPACE_URI } from '@/helpers/constant'

import type { Namespace } from '@/types'

/**
 * Refuse a namespace declaration written as an attribute: `xmlns`, `xmlns:<prefix>`, a name in the xmlns namespace,
 * or a namespace object of the `xmlns` prefix whatever its URI. A record holds no declaration: a document declares
 * its namespaces on export, from what its records use.
 *
 * @internal write-path guard behind every attribute name canonicalization, also run on a hook's record
 */
export function assertNotNamespaceDeclaration(params: {
	attribute: { name: string; namespace?: Namespace | string }
	tagName: string
}): void {
	const { attribute, tagName } = params
	const { name, namespace } = attribute
	const isDeclaration =
		name === 'xmlns' ||
		name.startsWith('xmlns:') ||
		(typeof namespace === 'object' &&
			(namespace?.uri === XMLNS_NAMESPACE_URI || namespace?.prefix === 'xmlns'))
	if (!isDeclaration) return
	throwDialecteError('NAMESPACE_DECLARATION_NOT_ALLOWED', {
		detail: `Attribute '${name}' on '${tagName}' is a namespace declaration - remove it; give a name its namespace in full: { name, namespace: { prefix, uri } }.`,
		ref: { tagName },
	})
}
