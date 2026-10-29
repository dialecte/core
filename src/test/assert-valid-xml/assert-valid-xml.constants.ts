import { DIALECTE_DEV_NAMESPACE, XMLNS_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'

/** Attributes any element may carry: namespace declarations, `xsi:*`, and the test record id. */
export const ALWAYS_ALLOWED_NAMESPACE_URIS: readonly string[] = [
	XMLNS_NAMESPACE_URI,
	XSI_NAMESPACE.uri,
	DIALECTE_DEV_NAMESPACE.uri,
]
