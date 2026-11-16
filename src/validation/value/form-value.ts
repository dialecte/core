import { ATOMIC_BUILTINS } from './builtins.constants'
import { isQName } from './names'
import { parseQualifiedName } from './qualified-name'
import { validateValue } from './validate-value'
import { UNJUDGED, XSI_TYPE_ATTRIBUTE } from './validate-value.constants'
import { normalizeWhiteSpace } from './whitespace'

import { throwDialecteError } from '@/errors'
import { readAttributeInput } from '@/helpers/attribute-input'
import { XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { xmlNamespaceOf } from '@/helpers/xml-namespace'
import { isNamespaceAllowedByWildcard } from '@/utils/namespaces'
import { admittedXsiTypes, isXsiTypeAdmitted, resolveDefinition } from '@/utils/resolve-definition'
import { storedNamespaceLookup, xsiTypeNameOf } from '@/utils/xsi-type'

import type {
	FormValueAttribute,
	FormValueParams,
	FormValueParent,
	FormValueTarget,
	ValueIssue,
} from './validate-value.types'
import type { DataType, DeclarationDefinition, ResolvedDefinition } from '@/types'
import type { DefinitionConfig, ResolvableRecord } from '@/utils/resolve-definition.types'
import type { NamespaceLookup, XsiTypeName } from '@/utils/xsi-type.types'

/**
 * What a value written to an attribute (or, without one, the text) of a child under a parent is judged as, the child
 * read as declared under that parent - it need not exist. Nothing but the parent is read: every prefix resolves
 * through the engine table (`storedNamespaceLookup`), `xml:` and `xsi:` always bound. The text of a child naming an
 * XSD built-in it admits with xsi:type is of that built-in; an `xsiType` bound nowhere refuses the value (`datatype`,
 * `QName`), as a write refuses it. An undeclared attribute is admitted when the declaration's wildcard admits its
 * namespace. An attribute the declaration does not have, or a child the parent cannot hold, is a wrong argument: it
 * throws.
 *
 * @throws `INVALID_PARENT_CHILD` when the parent cannot hold the child; the write path's keys for an attribute input
 *   it refuses (`readAttributeInput`): `UNKNOWN_NAMESPACE_PREFIX` for a key prefix or namespace key the dialecte does
 *   not declare, `PREFIXED_ATTRIBUTE_NAME` for a prefixed name in the object form (its canonical form aside),
 *   `NAMESPACE_DECLARATION_NOT_ALLOWED` for an `xmlns` one; `INVALID_ATTRIBUTE` when the child declares no such
 *   attribute and no wildcard admits it.
 */
export function formValueTarget(params: FormValueParams): FormValueTarget {
	const { dialecteConfig, parent, tagName, xsiType, attribute } = params
	const { child, parentDefinition, definition } = childDefinition(params)
	const read =
		attribute === undefined ? undefined : attributeName({ dialecteConfig, tagName, attribute })
	if (xsiType !== undefined && readXsiType({ dialecteConfig, value: xsiType }) === undefined)
		return { kind: 'refused', issue: qualifiedNameIssue(xsiType) }
	if (definition === undefined) return UNJUDGED

	if (read === undefined)
		return typedOrUnjudged(
			namedBuiltin({ dialecteConfig, child, parentDefinition, xsiType }) ??
				definition.textContent?.type,
		)
	const { name, namespaceUri } = read
	if (name === XSI_TYPE_ATTRIBUTE) return { kind: 'xsiType', child, parentDefinition }
	if (namespaceUri === XSI_NAMESPACE.uri) return UNJUDGED

	const declared = definition.attributes.details[name]
	if (declared !== undefined) return typedOrUnjudged(declared.type)
	if (isNamespaceAllowedByWildcard({ wildcard: definition.attributes.any, namespaceUri }))
		return UNJUDGED
	return throwDialecteError('INVALID_ATTRIBUTE', {
		detail: `'${tagName}' under '${parent.tagName}' declares no attribute '${name}'.`,
		ref: { tagName },
		meta: { parent: parent.tagName, tagName, attribute: name },
	})
}

/**
 * Whether a value may be written where its target says (`formValueTarget`). A QName resolves through the engine table
 * (`xml:` always bound); a Clark name `{uri}local` is no QName value (`datatype`), and a QName whose prefix the
 * dialecte does not declare is not judged yet (`undefined`). `xsi:type` must name a type the declaration admits (`isXsiTypeAdmitted`, the write path's rule),
 * read as a write reads it. An unjudged target admits any value (`undefined`).
 */
export function validateFormValue(params: {
	dialecteConfig: DefinitionConfig
	target: FormValueTarget
	value: string
}): ValueIssue | undefined {
	const { dialecteConfig, target, value } = params
	if (target.kind === 'refused') return target.issue
	if (target.kind === 'xsiType')
		return xsiTypeIssue({
			dialecteConfig,
			child: target.child,
			parentDefinition: target.parentDefinition,
			value,
		})
	if (target.kind !== 'datatype') return undefined
	const namespaces = valueNamespaces({ dialecteConfig })
	if (readsQualifiedNames(target.type) && namesUndeclaredPrefix({ value, namespaces }))
		return undefined
	return validateValue({ value, type: target.type, namespaces })
}

/** The child as declared under the parent (refused when the parent cannot hold it), and its definition there. */
function childDefinition(params: FormValueParams): {
	child: ResolvableRecord
	parentDefinition: ResolvedDefinition | undefined
	definition: ResolvedDefinition | undefined
} {
	const { dialecteConfig, parent, tagName, xsiType } = params
	const parentDefinition = resolveDefinition({ dialecteConfig, record: parent })
	const child: ResolvableRecord = {
		tagName,
		parent: { id: parent.id, tagName: parent.tagName },
		attributes:
			xsiType === undefined
				? []
				: [{ name: XSI_TYPE_ATTRIBUTE, value: xsiType, namespace: XSI_NAMESPACE }],
	}
	assertHeld({ parent, parentDefinition, tagName })
	const definition = resolveDefinition({ dialecteConfig, record: child, parentDefinition })
	return { child, parentDefinition, definition }
}

/**
 * The XSD built-in the child names with xsi:type, when its declaration admits it (`isXsiTypeAdmitted`): its text is
 * of that type, not of the declared one. `undefined` without xsi:type, for a type that is no built-in, or one not
 * admitted.
 */
function namedBuiltin(params: {
	dialecteConfig: DefinitionConfig
	child: ResolvableRecord
	parentDefinition: DeclarationDefinition | undefined
	xsiType: string | undefined
}): DataType | undefined {
	const { dialecteConfig, child, parentDefinition, xsiType } = params
	if (xsiType === undefined) return undefined
	const named = readXsiType({ dialecteConfig, value: xsiType })
	if (named === undefined || named.namespace !== XSD_NAMESPACE_URI) return undefined
	const record = { ...child, attributes: [] }
	if (!isXsiTypeAdmitted({ dialecteConfig, record, parentDefinition, typeName: named.clark }))
		return undefined
	return { builtin: named.local }
}

/** A datatype as a target; none (a plain string, untyped text) is not judged. */
function typedOrUnjudged(type: DataType | undefined): FormValueTarget {
	return type === undefined ? UNJUDGED : { kind: 'datatype', type }
}

/** Whether a datatype reads a qualified name: a built-in parsed as one, or a list or union holding one. */
function readsQualifiedNames(type: DataType): boolean {
	if ('list' in type) return readsQualifiedNames(type.list)
	if ('union' in type) return type.union.some(readsQualifiedNames)
	return ATOMIC_BUILTINS[type.builtin]?.parse === parseQualifiedName
}

/** Refuse a child the parent's declaration cannot hold (a wildcard holds any). */
function assertHeld(params: {
	parent: FormValueParent
	parentDefinition: ResolvedDefinition | undefined
	tagName: string
}): void {
	const { parent, parentDefinition, tagName } = params
	if (parentDefinition === undefined || parentDefinition.children.any) return
	if (parentDefinition.children.sequence.includes(tagName)) return
	throwDialecteError('INVALID_PARENT_CHILD', {
		detail: `'${parent.tagName}' cannot hold '${tagName}'.`,
		ref: { tagName: parent.tagName, id: parent.id },
		meta: { parent: parent.tagName, tagName },
	})
}

/**
 * An `xsi:type` value naming a type the declaration admits (`isXsiTypeAdmitted`, the write path's rule); a prefix
 * bound nowhere refuses it as a QName.
 */
function xsiTypeIssue(params: {
	dialecteConfig: DefinitionConfig
	child: ResolvableRecord
	parentDefinition: DeclarationDefinition | undefined
	value: string
}): ValueIssue | undefined {
	const { dialecteConfig, child, parentDefinition, value } = params
	const typeName = readXsiType({ dialecteConfig, value })?.clark
	if (typeName === undefined) return qualifiedNameIssue(value)
	const record = { ...child, attributes: [] }
	if (isXsiTypeAdmitted({ dialecteConfig, record, parentDefinition, typeName })) return undefined
	return {
		reason: 'datatype',
		actual: normalizeWhiteSpace({ value, whiteSpace: 'collapse' }),
		expected: admittedXsiTypes({ dialecteConfig, record, parentDefinition }),
	}
}

/**
 * The one reader of an `xsi:type` value, the value written and the `xsiType` param alike: the write path's
 * (`xsiTypeNameOf` over the engine table, a Clark name read as itself). `undefined` for a prefix bound nowhere.
 */
function readXsiType(params: {
	dialecteConfig: DefinitionConfig
	value: string
}): XsiTypeName | undefined {
	const { dialecteConfig, value } = params
	return xsiTypeNameOf({ value, namespaceOf: storedNamespaceLookup({ dialecteConfig }) })
}

/** A value refused as a QName: its prefix is bound nowhere. */
function qualifiedNameIssue(value: string): ValueIssue {
	return {
		reason: 'datatype',
		actual: normalizeWhiteSpace({ value, whiteSpace: 'collapse' }),
		expected: 'QName',
	}
}

/** How a QName value's prefixes resolve: the engine table (`storedNamespaceLookup`), `xml` always bound. */
function valueNamespaces(params: { dialecteConfig: DefinitionConfig }): NamespaceLookup {
	const table = storedNamespaceLookup(params)
	return function namespaceOf(prefix) {
		return xmlNamespaceOf(prefix)?.uri ?? table(prefix)
	}
}

/**
 * Whether a value is made of lexical QNames, one of them with a prefix `namespaces` does not bind: a QName left
 * unjudged. A value with a name that is no QName (`a:b:c`, `1a:x`, a Clark name) is judged, whatever its prefixes.
 */
function namesUndeclaredPrefix(params: { value: string; namespaces: NamespaceLookup }): boolean {
	const { value, namespaces } = params
	const collapsed = normalizeWhiteSpace({ value, whiteSpace: 'collapse' })
	const names = collapsed === '' ? [] : collapsed.split(' ')
	if (!names.every(isQName)) return false
	return names.some((name) => {
		const colon = name.indexOf(':')
		return colon !== -1 && namespaces(name.slice(0, colon)) === undefined
	})
}

/**
 * The attribute's stored name and the namespace it is in, read by the write path's reader (`readAttributeInput`) in
 * the write path's two forms: a string is a value-object key (canonical, possibly prefixed: `ext:cA`, `xsi:type`,
 * `xml:lang`), an object the full-object form an author writes (`{ name, namespace }`). An unprefixed namespace is
 * no namespace.
 */
function attributeName(params: {
	dialecteConfig: DefinitionConfig
	tagName: string
	attribute: FormValueAttribute
}): { name: string; namespaceUri: string } {
	const { dialecteConfig, tagName, attribute } = params
	const authored = typeof attribute !== 'string'
	const { name, namespace } = readAttributeInput({
		dialecteConfig,
		attribute: authored ? attribute : { name: attribute },
		tagName,
		authored,
	})
	return { name, namespaceUri: namespace?.prefix ? namespace.uri : '' }
}
