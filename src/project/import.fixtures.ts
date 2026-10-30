import { TEST_DIALECTE_CONFIG } from '@/test'

import type { AnyDialecteConfig } from '@/types'

/** A file of core's test dialecte: `body` under its root, in the default namespace. */
export function xmlFile(params: { body: string; name: string }): File {
	const { body, name } = params
	const config = TEST_DIALECTE_CONFIG as unknown as AnyDialecteConfig
	const namespaceUri = config.namespaces.default.uri
	return new File([`<Root xmlns="${namespaceUri}">${body}</Root>`], name, { type: 'text/xml' })
}
