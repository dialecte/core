import { readsQualifiedNames } from './qname-typed'
import { qualifiedNameOf } from './qualified-name'
import { readXmlTextRun, trimXmlWhitespace } from './xml-whitespace'
import { ENGINE_XSD_PREFIX } from './xsi-type.constants'

import { throwDialecteError } from '@/errors'
import { XML_NAMESPACE, XSD_NAMESPACE_URI } from '@/helpers/constant'
import { unionMemberOf } from '@/validation/value/validate-value'

import type { NamespaceLookup, NamespacesConfig } from './qname-value.types'
import type { DataType, Namespace } from '@/types'

export type { NamespaceLookup, NamespacesConfig, QualifiedName } from './qname-value.types'

/**
 * The form core stores a qualified name in (xsi:type, a QName or NOTATION value), one string whose prefixes come from
 * the engine table only: the local name for the dialecte's default namespace, `prefix:local` for a namespace the
 * dialecte declares, `xml:local` for the XML namespace, `xs:local` for XSD (unless the dialecte declares the prefix `xs` itself), `{}local` for no
 * namespace when the default is not empty, and a Clark name `{uri}local` for any other namespace. A name whose prefix
 * is bound nowhere is kept as written. The value keeps what XML says it means: only the prefix it is written with
 * changes.
 *
 * @internal stored form of every qualified name; `canonicalXsiType` offers it for xsi:type
 */
export function canonicalQualifiedName(params: {
	dialecteConfig: NamespacesConfig
	value: string
	namespaceOf: NamespaceLookup
}): string {
	const { dialecteConfig, value, namespaceOf } = params
	const name = qualifiedNameOf({ value, namespaceOf })
	if (name === undefined) return value
	if (name.namespace === dialecteConfig.namespaces.default.uri) return name.local
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	const declared = namespaces.find(
		(candidate) => candidate.uri === name.namespace && candidate.prefix !== '',
	)
	if (declared) return `${declared.prefix}:${name.local}`
	if (name.namespace === XML_NAMESPACE.uri) return `${XML_NAMESPACE.prefix}:${name.local}`
	const xsTaken = namespaces.some((candidate) => candidate.prefix === ENGINE_XSD_PREFIX)
	if (name.namespace === XSD_NAMESPACE_URI && !xsTaken) return `${ENGINE_XSD_PREFIX}:${name.local}`
	if (name.namespace === '') return `{}${name.local}`
	return `{${name.namespace}}${name.local}`
}

/**
 * The lookup that reads a stored qualified name (xsi:type, a QName value): the engine table only, no document
 * declaration. `''` is the dialecte's default namespace, a config prefix its namespace, `xml` the XML namespace
 * (bound in every document), `xs` XSD unless the config uses `xs` itself; any other prefix is `undefined`.
 *
 * @intent read a stored xsi:type or QName value, resolve a stored prefix to its namespace
 */
export function storedNamespaceLookup(params: {
	dialecteConfig: NamespacesConfig
}): NamespaceLookup {
	const { dialecteConfig } = params
	const namespaces = Object.values(dialecteConfig.namespaces) as Namespace[]
	return function namespaceOf(prefix) {
		if (!prefix) return dialecteConfig.namespaces.default.uri
		const declared = namespaces.find((namespace) => namespace.prefix === prefix)
		if (declared) return declared.uri
		if (prefix === XML_NAMESPACE.prefix) return XML_NAMESPACE.uri
		return prefix === ENGINE_XSD_PREFIX ? XSD_NAMESPACE_URI : undefined
	}
}

/**
 * A value of a QName-typed attribute or text in the form core stores it: each qualified name in the engine table's
 * form (`canonicalQualifiedName`: `local`, `prefix:local`, `xs:local`, `{}local`, Clark `{uri}local`), read with
 * `namespaceOf` (the file's in-scope bindings on import, the engine table on a write). A list is collapsed and each
 * item stored that way; a name whose prefix nothing binds is kept as written. Any other value is returned as is.
 *
 * @internal stored form of QName values (import, writes, filters)
 */
export function canonicalQNameValue(params: {
	dialecteConfig: NamespacesConfig
	type: DataType
	value: string
	namespaceOf: NamespaceLookup
	/** The value is read as a file writes it: a qualified name is lexical only, a Clark name is no QName. */
	lexicalOnly?: boolean
}): string {
	const { dialecteConfig, value, namespaceOf, lexicalOnly = false } = params
	const type = qualifiedNameTypeOf({ type: params.type, value, namespaceOf, lexicalOnly })
	if (type === undefined) return value
	if ('builtin' in type) {
		if (lexicalOnly && isClarkName(value)) return value
		return canonicalQualifiedName({ dialecteConfig, value, namespaceOf })
	}
	return itemsOf(value)
		.map((item) =>
			canonicalQNameValue({
				dialecteConfig,
				type: type.list,
				value: item,
				namespaceOf,
				lexicalOnly,
			}),
		)
		.join(' ')
}

/**
 * The type that reads a value's qualified names: the type itself when it is xs:QName, NOTATION or a list of one; for
 * a union, its first member that admits the value (`unionMemberOf`, XSD's rule), when that member reads qualified
 * names (read lexically only for a file's value). `undefined` when the value holds no qualified name: another type, or a union whose admitting member is no
 * QName (`12` of integer | QName), or which no member admits.
 *
 * @internal which values import, writes, export and filters read as qualified names
 */
export function qualifiedNameTypeOf(params: {
	type: DataType
	value: string
	namespaceOf: NamespaceLookup
	/** The value is read as a file writes it: a Clark name is no QName (a union member reading one refuses it). */
	lexicalOnly?: boolean
}): Exclude<DataType, { union: readonly DataType[] }> | undefined {
	const { type, value, namespaceOf, lexicalOnly = false } = params
	if (!readsQualifiedNames(type)) return undefined
	if (!('union' in type)) return type
	const member = unionMemberOf({ value, type, namespaces: namespaceOf, clarkNames: !lexicalOnly })
	return member !== undefined && readsQualifiedNames(member) ? member : undefined
}

/**
 * Refuse each qualified name of a QName-typed value core cannot read (`assertQualifiedNameReadable`): the value
 * itself, or each item of a list.
 *
 * @internal the write-path guard of one QName-typed value
 */
export function assertQNameValueReadable(params: {
	dialecteConfig: NamespacesConfig
	type: DataType
	value: string
	what: string
	tagName: string
}): void {
	const { dialecteConfig, type, value, what, tagName } = params
	if (!readsQualifiedNames(type) || value === '') return
	if ('builtin' in type) {
		assertQualifiedNameReadable({ dialecteConfig, value, what, tagName })
		return
	}
	if ('list' in type) {
		for (const item of itemsOf(value))
			assertQNameValueReadable({ dialecteConfig, type: type.list, value: item, what, tagName })
		return
	}
	// a union: a value some member admits is readable; one none admits is refused as its first QName member refuses it
	const namespaces = storedNamespaceLookup({ dialecteConfig })
	if (unionMemberOf({ value, type, namespaces, clarkNames: true }) !== undefined) return
	const member = flatMembersOf(type).find(readsQualifiedNames)
	if (member !== undefined)
		assertQNameValueReadable({ dialecteConfig, type: member, value, what, tagName })
}

/** A union's members in order, each member union opened to its own. */
function flatMembersOf(type: Extract<DataType, { union: readonly DataType[] }>): DataType[] {
	return type.union.flatMap((member) => ('union' in member ? flatMembersOf(member) : [member]))
}

/**
 * Refuse a qualified name a write authors when core cannot read it from the engine table: a prefix the table does
 * not bind (`UNKNOWN_NAMESPACE_PREFIX` naming it), a prefix with no local name (`ext:`) or a local name with no prefix
 * (`:x`), or a malformed Clark name
 * (no closing brace, no local name).
 *
 * @internal the write-path guard shared by xsi:type and every QName-typed value
 */
export function assertQualifiedNameReadable(params: {
	dialecteConfig: NamespacesConfig
	value: string
	/** What the value is, in the refusal: `xsi:type value`, `value of 'aEE_1'`. */
	what: string
	tagName: string
}): void {
	const { dialecteConfig, what, tagName } = params
	const value = trimXmlWhitespace({ text: params.value })
	if (value.startsWith('{')) {
		assertClarkNameReadable({ value, what, tagName })
		return
	}
	const colon = value.indexOf(':')
	if (colon === -1) return
	if (colon === 0 || colon === value.length - 1) {
		throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
			detail: `Malformed ${what} '${value}' on '${tagName}' - a qualified name is 'prefix:local' or 'local'.`,
			ref: { tagName },
		})
	}
	const prefix = value.slice(0, colon)
	if (storedNamespaceLookup({ dialecteConfig })(prefix) !== undefined) return
	throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
		detail: `Unknown namespace prefix '${prefix}' in the ${what} '${value}' on '${tagName}' - use a prefix the dialecte declares, 'xs', or the Clark name '{uri}local'.`,
		ref: { tagName },
	})
}

/**
 * The items of a list value: XML white space collapsed, split on the one space left between items.
 *
 * @internal how import, writes and export read a list
 */
export function itemsOf(value: string): string[] {
	const collapsed = readXmlTextRun({ text: value })
	return collapsed === '' ? [] : collapsed.split(' ')
}

/** Refuse a Clark value core cannot read: `{uri}local` needs its closing brace and a local name that is an NCName. */
function assertClarkNameReadable(params: { value: string; what: string; tagName: string }): void {
	const { value, what, tagName } = params
	if (qualifiedNameOf({ value, namespaceOf: () => undefined }) !== undefined) return
	throwDialecteError('UNKNOWN_NAMESPACE_PREFIX', {
		detail: `Malformed ${what} '${value}' on '${tagName}' - a Clark name is '{uri}local'.`,
		ref: { tagName },
	})
}

/** Whether a value, trimmed of XML whitespace, is written as a Clark name `{uri}local` (no lexical QName). */
function isClarkName(value: string): boolean {
	return trimXmlWhitespace({ text: value }).startsWith('{')
}
