import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, sep } from 'node:path'

import { WRITTEN, WRITTEN_AS_ALIAS } from './shared-shapes.fixtures.constants'

import ts from 'typescript'

import type { SharedShape, SharedShapeRoot } from './shared-shapes.fixtures.types'

/** `path` with `/` between its parts, as the TypeScript compiler names files on every platform. */
export function posixPathOf(params: { path: string; separator?: string }): string {
	const { path, separator = sep } = params
	return path.split(separator).join('/')
}

/** Whether the run is a CI's: `CI` set, and to neither `false` nor `0`. */
export function runsInCi(params: { value: string | undefined }): boolean {
	const { value } = params
	return value !== undefined && value !== '' && value !== 'false' && value !== '0'
}

/**
 * The text recorded at `file`, read from disk each time and never rewritten. Absent, it is written from `text` (a
 * new version's first local run) - except in CI, where it would be lost: refused with `missing`, nothing written.
 */
export function recordedText(params: {
	file: string
	text: string
	ci: boolean
	missing: string
}): string {
	const { file, text, ci, missing } = params
	if (existsSync(file)) return readFileSync(file, 'utf8')
	if (ci) throw new Error(missing)
	mkdirSync(dirname(file), { recursive: true })
	writeFileSync(file, text)
	return text
}

/** `string & {}`: a string the checker keeps apart from its literals, which keeps a union of them open. */
function isOpenString(type: ts.Type): boolean {
	return (
		type.isIntersection() &&
		type.types.some(function isString(member) {
			return (member.flags & ts.TypeFlags.String) !== 0
		})
	)
}

/** Whether a type's declaration is the package's own (a type a copy of another version may hold otherwise). */
function declaredInPackage(params: { symbol: ts.Symbol; sources: string }): boolean {
	return (
		params.symbol.declarations?.[0]?.getSourceFile().fileName.startsWith(params.sources) ?? false
	)
}

function objectFlagsOf(params: { type: ts.Type }): number {
	return (params.type as ts.ObjectType).objectFlags ?? 0
}

/**
 * The shared shape as text: each root, and every named type of the package its members reach (through unions,
 * members, index signatures, signatures and type arguments), one block each - its type parameters with their
 * constraints and defaults, then one member per line, or its definition; unions in sorted order, named types by their
 * names. A member added, removed or retyped anywhere in that graph changes it. Written by the TypeScript checker: an
 * upgrade of TypeScript may write it otherwise. `packageRoot` `/`-separated, as the checker names files.
 */
export function sharedShape(params: {
	packageRoot: string
	roots: SharedShapeRoot[]
}): SharedShape {
	const { packageRoot, roots } = params
	const sources = `${packageRoot}/src/`
	const config = ts.readConfigFile(`${packageRoot}/tsconfig.vitest.json`, ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
	const program = ts.createProgram({
		rootNames: roots.map(function pathOf(root) {
			return `${packageRoot}/${root.file}`
		}),
		options: { ...parsed.options, noEmit: true, composite: false, incremental: false },
	})
	const checker = program.getTypeChecker()
	const rootSources = roots.map(function sourceOf(root) {
		return { root, source: program.getSourceFile(`${packageRoot}/${root.file}`)! }
	})
	// where a member's type is read: any file of the program answers the same for a declared member
	const source = rootSources[0]!.source
	const pending = rootSources.flatMap(function rootsOf({ root, source: rootSource }) {
		// the file's own types as it exports them, the ones it imports as their aliases
		const known = [
			...checker.getExportsOfModule(checker.getSymbolAtLocation(rootSource)!),
			...checker.getSymbolsInScope(rootSource, ts.SymbolFlags.Alias),
		]
		return root.names.map(function rootOf(typeName) {
			const symbol = known.find(function named(candidate) {
				return candidate.name === typeName
			})
			if (!symbol) throw new Error(`${typeName} is neither declared nor imported in ${root.file}`)
			return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
		})
	})

	/** A named type `type` is an instance of: its alias, its interface or class (of a generic one too), its enum. */
	function namedOf(params: { type: ts.Type }): ts.Symbol | undefined {
		const { type } = params
		if (type.aliasSymbol) return type.aliasSymbol
		const symbol = type.getSymbol()
		// an enum's member: its enum
		if (type.flags & ts.TypeFlags.EnumLiteral)
			return checker.getBaseTypeOfLiteralType(type).getSymbol()
		if (type.flags & ts.TypeFlags.Enum) return symbol
		const objectFlags = objectFlagsOf({ type })
		if (objectFlags & ts.ObjectFlags.Reference) {
			const target = (type as ts.TypeReference).target
			if (objectFlagsOf({ type: target }) & (ts.ObjectFlags.Interface | ts.ObjectFlags.Class))
				return target.symbol
		}
		if (objectFlags & (ts.ObjectFlags.Interface | ts.ObjectFlags.Class)) return symbol
		return undefined
	}

	function typeArgumentsOf(params: { type: ts.Type }): readonly ts.Type[] {
		const { type } = params
		const isReference = (objectFlagsOf({ type }) & ts.ObjectFlags.Reference) !== 0
		return [
			...(isReference ? checker.getTypeArguments(type as ts.TypeReference) : []),
			...(type.aliasTypeArguments ?? []),
		]
	}

	/** The named types of the package `type` reaches: queued to be described each in its own block. */
	function reachedFrom(params: { type: ts.Type; walked: Set<ts.Type> }): void {
		const { type, walked } = params
		if (walked.has(type)) return
		walked.add(type)
		const named = namedOf({ type })
		if (named && declaredInPackage({ symbol: named, sources })) {
			pending.push(named)
			for (const argument of typeArgumentsOf({ type })) reachedFrom({ type: argument, walked })
			return
		}
		structureOf({ type, walked, foreign: named !== undefined })
	}

	/** What `type` holds, followed: union members, its arguments, and - unless named outside the package - its members, index signatures and signatures. */
	function structureOf(params: { type: ts.Type; walked: Set<ts.Type>; foreign?: boolean }): void {
		const { type, walked, foreign = false } = params
		if (type.isUnionOrIntersection()) {
			for (const member of type.types) reachedFrom({ type: member, walked })
			return
		}
		if (!(type.flags & ts.TypeFlags.Object)) return
		for (const argument of typeArgumentsOf({ type })) reachedFrom({ type: argument, walked })
		// a type named outside the package (Promise, Blob, Map): only its arguments are the package's concern
		if (foreign) return
		for (const property of type.getProperties()) {
			reachedFrom({ type: checker.getTypeOfSymbolAtLocation(property, source), walked })
		}
		for (const info of checker.getIndexInfosOfType(type)) reachedFrom({ type: info.type, walked })
		for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
			for (const parameter of signature.getParameters()) {
				reachedFrom({ type: checker.getTypeOfSymbolAtLocation(parameter, source), walked })
			}
			reachedFrom({ type: signature.getReturnType(), walked })
		}
	}

	/** A type as a member holds it: a union's members sorted (the checker orders them as it met them). */
	function written(params: {
		type: ts.Type
		flags?: ts.TypeFormatFlags
		/** A named type's own definition: a union written by its members, not by its name. */
		definition?: boolean
	}): string {
		const { type, flags = WRITTEN, definition = false } = params
		if (type.isUnion() && (definition || !type.aliasSymbol)) {
			// open to any string (a catalogue, `| (string & {})`): its strings, which a copy of another version may extend
			// freely, written `string`; its other members kept
			const open = type.types.some(isOpenString)
			const members = type.types.filter(function keptWhenOpen(member) {
				return !open || !(isOpenString(member) || member.isStringLiteral())
			})
			return [
				...members.map(function memberWritten(member) {
					return written({ type: member, flags })
				}),
				...(open ? ['string'] : []),
			]
				.sort()
				.join(' | ')
		}
		return checker.typeToString(type, undefined, flags)
	}

	/** A named type's own type parameters, as declared (constraints and defaults included). */
	function typeParametersOf(params: { symbol: ts.Symbol }): string {
		const declaration = params.symbol.declarations?.[0] as
			| ts.DeclarationWithTypeParameterChildren
			| undefined
		const parameters = declaration?.typeParameters
		if (!parameters?.length) return ''
		return `<${parameters
			.map(function declared(parameter) {
				return parameter.getText()
			})
			.join(', ')}>`
	}

	/** A named type's block: its name and type parameters, then one member per line, or its definition. */
	function blockOf(params: { symbol: ts.Symbol }): string {
		const { symbol } = params
		const head = `${symbol.name}${typeParametersOf({ symbol })}`
		const walked = new Set<ts.Type>()
		if (symbol.flags & ts.SymbolFlags.Enum) {
			const members = checker
				.getExportsOfModule(symbol)
				.map(function memberOf(member) {
					const value = checker.getConstantValue(member.valueDeclaration as ts.EnumMember)
					return `  ${member.name} = ${JSON.stringify(value)}`
				})
				.sort()
			return `enum ${head} {\n${members.join('\n')}\n}`
		}
		const type = checker.getDeclaredTypeOfSymbol(symbol)
		walked.add(type)
		const properties = type.isUnion() ? [] : type.getProperties()
		const indexInfos = type.isUnion() ? [] : checker.getIndexInfosOfType(type)
		if (properties.length === 0 && indexInfos.length === 0) {
			structureOf({ type, walked })
			return `${head} = ${written({ type, flags: WRITTEN_AS_ALIAS, definition: true })}`
		}
		const members = properties.map(function memberOf(property) {
			const optional = property.flags & ts.SymbolFlags.Optional ? '?' : ''
			const memberType = checker.getTypeOfSymbolAtLocation(property, source)
			reachedFrom({ type: memberType, walked })
			return `  ${property.name}${optional}: ${written({ type: memberType })}`
		})
		const indexes = indexInfos.map(function indexOf(info) {
			reachedFrom({ type: info.type, walked })
			return `  [key: ${written({ type: info.keyType })}]: ${written({ type: info.type })}`
		})
		return `${head} {\n${[...members.sort(), ...indexes.sort()].join('\n')}\n}`
	}

	const described = new Set<ts.Symbol>()
	const blocks: string[] = []
	while (pending.length > 0) {
		const symbol = pending.shift()!
		if (described.has(symbol)) continue
		described.add(symbol)
		blocks.push(blockOf({ symbol }))
	}
	const declaredIn = new Set(
		Array.from(described, function fileOf(symbol) {
			return symbol.declarations![0]!.getSourceFile().fileName.slice(packageRoot.length + 1)
		}),
	)
	return { text: `${blocks.sort().join('\n\n')}\n`, declaredIn: Array.from(declaredIn).sort() }
}
