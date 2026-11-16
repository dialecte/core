import { checkValue } from './validate-value'
import { UNJUDGED, XSI_TYPE_ATTRIBUTE } from './validate-value.constants'
import { normalizeWhiteSpace } from './whitespace'

import { throwDialecteError } from '@/errors'
import { readAttributeInput } from '@/helpers/attribute-input'
import { XSD_NAMESPACE_URI, XSI_NAMESPACE } from '@/helpers/constant'
import { isNamespaceAllowedByWildcard } from '@/utils/namespaces'
import { storedNamespaceLookup } from '@/utils/qname-value'
import { qualifiedNameOf } from '@/utils/qualified-name'
import { admittedXsiTypes, isXsiTypeAdmitted, resolveDefinition } from '@/utils/resolve-definition'

import type {
	FormValueAttribute,
	FormValueParams,
	FormValueParent,
	FormValueTarget,
	ValueIssue,
} from './validate-value.types'
import type { DataType, DeclarationDefinition, ResolvedDefinition } from '@/types'
import type { QualifiedName } from '@/utils/qname-value.types'
import type { DefinitionConfig, ResolvableRecord } from '@/utils/resolve-definition.types'

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
 * Whether a value may be written where its target says (`formValueTarget`), read as a write reads it. A qualified name
 * resolves through the engine table (`storedNamespaceLookup`, `xml:` always bound) or is its Clark name `{uri}local`
 * (`{}local` in no namespace); a prefix the dialecte does not declare refuses it (`datatype`), as the write does. A
 * union's value is judged by its first admitting member. `xsi:type` must name a type the declaration admits
 * (`isXsiTypeAdmitted`, the write path's rule). An unjudged target admits any value (`undefined`).
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
	const namespaces = storedNamespaceLookup({ dialecteConfig })
	return checkValue({ value, type: target.type, namespaces, clarkNames: true }).issue
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
 * (`qualifiedNameOf` over the engine table, a Clark name read as itself). `undefined` for a prefix bound nowhere.
 */
function readXsiType(params: {
	dialecteConfig: DefinitionConfig
	value: string
}): QualifiedName | undefined {
	const { dialecteConfig, value } = params
	return qualifiedNameOf({ value, namespaceOf: storedNamespaceLookup({ dialecteConfig }) })
}

/** A value refused as a QName: its prefix is bound nowhere. */
function qualifiedNameIssue(value: string): ValueIssue {
	return {
		reason: 'datatype',
		actual: normalizeWhiteSpace({ value, whiteSpace: 'collapse' }),
		expected: 'QName',
	}
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
