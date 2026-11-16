import { assertNotNamespaceDeclaration } from './assert-not-namespace-declaration'
import { xmlNamespaceOf } from './xml-namespace'

import { throwDialecteError } from '@/errors'
import { extractLocalName } from '@/utils/attribute-rules'
import { resolveNamespaceByPrefix, resolveNamespaceByScope } from '@/utils/namespaces'

import type { AttributeInput, ReadAttributeInput } from './attribute-input.types'
import type { AnyDialecteConfig, Namespace } from '@/types'

/**
 * The one reader of an attribute input, the write path's and `validate.value`'s: a namespace declaration is refused;
 * an authored name (`authored`, the full-object form) is local - a prefix baked into it is ambiguous, unless it is
 * the canonical form whose `Namespace` object has that prefix; a namespace given by config key resolves through the
 * dialecte (else it is unknown), a `Namespace` object is used as given, and a prefixed name without one (a value-object
 * key) takes the namespace the dialecte declares for its prefix (`xml` is always bound). A namespace the dialecte declares is named with the
 * dialecte's prefix, whatever prefix the input gave it; a prefixed namespace makes the name `prefix:local`.
 *
 * @throws `NAMESPACE_DECLARATION_NOT_ALLOWED` for an `xmlns` attribute, `PREFIXED_ATTRIBUTE_NAME` for an authored
 *   prefixed name its namespace does not back, `UNKNOWN_NAMESPACE_PREFIX` for a namespace key or a name prefix the
 *   dialecte does not declare.
 *
 * @internal shared by the write path (create's authored names, the converter's canonical names) and `validate.value`
 */
export function readAttributeInput(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'namespaces'>
	attribute: AttributeInput
	tagName: string
	/** The input is the full-object form an author writes: its name must be local, or its canonical form. */
	authored: boolean
}): ReadAttributeInput {
	const { dialecteConfig, attribute, tagName, authored } = params
	assertNotNamespaceDeclaration({ attribute, tagName })
	if (authored) assertAuthoredNameLocal({ attribute, tagName })
	const namespace = attributeNamespace({ dialecteConfig, attribute, tagName })
	if (namespace && namespace.prefix)
		return { name: `${namespace.prefix}:${extractLocalName(attribute.name)}`, namespace }
	return { name: attribute.name, namespace }
}

/**
 * An authored name is local: a prefix baked into it is ambiguous (which wins, name or namespace?), unless its
 * `Namespace` object already has that prefix - the canonical stored form a clone replays.
 */
function assertAuthoredNameLocal(params: { attribute: AttributeInput; tagName: string }): void {
	const { attribute, tagName } = params
	const { name, namespace } = attribute
	if (!name.includes(':')) return
	const isConsistentCanonicalForm =
		typeof namespace === 'object' && namespace?.prefix === name.slice(0, name.indexOf(':'))
	if (isConsistentCanonicalForm) return
	throwDialecteError('PREFIXED_ATTRIBUTE_NAME', {
		detail: `Attribute '${name}' on '${tagName}' is prefixed — pass a local name plus its namespace instead: { name: '${extractLocalName(name)}', namespace }.`,
		ref: { tagName },
	})
}

/**
 * The namespace of an input: a config key (or declared prefix) resolved, a `Namespace` object as given, else the
 * declared namespace of the name's prefix - under the dialecte's own prefix when the dialecte declares its URI.
 */
function attributeNamespace(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'namespaces'>
	attribute: AttributeInput
	tagName: string
}): Namespace | undefined {
	const { dialecteConfig, attribute, tagName } = params
	let namespace: Namespace | undefined
	if (typeof attribute.namespace === 'string') {
		namespace = resolveNamespaceByScope(dialecteConfig, attribute.namespace)
		if (!namespace) {
			throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
				detail: `Unknown namespace '${attribute.namespace}' on attribute '${attribute.name}' — use a registered namespace key or pass a full { name, namespace: { prefix, uri } }.`,
				ref: { tagName },
			})
		}
	} else {
		namespace = attribute.namespace
	}

	// Resolve the namespace: carried on the attribute, else inferred from a prefixed
	// name via the config's declared namespaces (consumers can't extend that config,
	// so an unresolvable prefix is a caller error, not a silent drop).
	const colonIndex = attribute.name.indexOf(':')
	if (!namespace && colonIndex !== -1) {
		const prefix = attribute.name.slice(0, colonIndex)
		// `xml` is bound in every document, never declared
		namespace = xmlNamespaceOf(prefix) ?? resolveNamespaceByPrefix(dialecteConfig, prefix)
		if (!namespace) {
			throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
				detail: `Unknown namespace prefix '${prefix}' on attribute '${attribute.name}' — pass it explicitly as { name, namespace: { prefix, uri } }.`,
				ref: { tagName },
			})
		}
	}

	// A namespace the dialecte declares is stored under the dialecte's prefix, whatever prefix a document bound to it
	// (`x:cA` with x bound to ext's URI is `ext:cA`): the name every typed lookup, filter and write uses.
	if (namespace && namespace.prefix)
		return dialecteNamespaceOf({ dialecteConfig, uri: namespace.uri }) ?? namespace
	return namespace
}

/** The namespace the dialecte declares for a URI, under a prefix: `undefined` for its default one or another URI. */
function dialecteNamespaceOf(params: {
	dialecteConfig: Pick<AnyDialecteConfig, 'namespaces'>
	uri: string
}): Namespace | undefined {
	const { dialecteConfig, uri } = params
	return (Object.values(dialecteConfig.namespaces) as Namespace[]).find(
		(namespace) => namespace.uri === uri && namespace.prefix !== '',
	)
}
