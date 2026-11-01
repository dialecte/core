import { fileURLToPath } from 'node:url'

import { SQLITE_STORAGE_VERSION } from './sqlite-storage.constants'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { TEST_ENTRY_COMPILE_TIMEOUT_MS } from '@/test/test-timing.constants'

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const SOURCES = `${PACKAGE_ROOT}/src/`
const SHARED_TYPES = fileURLToPath(new URL('./sqlite-storage.types.ts', import.meta.url))

/** The types copies of the library share through the registration: a copy's Project calls another copy's store. */
const SHARED_TYPE_NAMES = ['SqliteStorage', 'Store'] as const

/** How the checker writes a type: whole (no `...`), named types by their names. */
const WRITTEN = ts.TypeFormatFlags.NoTruncation
/** How the checker writes a type alias's own definition: its first level written out. */
const WRITTEN_AS_ALIAS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias

/** The recorded shape of a storage version: a file per version, never rewritten once committed. */
function shapeFileOf(params: { version: number }): string {
	return `./__shapes__/sqlite-storage-v${params.version}.txt`
}

/** Whether a type's declaration is the package's own (a type a copy of another version may hold otherwise). */
function declaredInPackage(params: { symbol: ts.Symbol }): boolean {
	return params.symbol.declarations?.[0]?.getSourceFile().fileName.startsWith(SOURCES) ?? false
}

function objectFlagsOf(params: { type: ts.Type }): number {
	return (params.type as ts.ObjectType).objectFlags ?? 0
}

/**
 * The shared shape as text: each shared type, and every named type of the package its members reach (through
 * unions, members, index signatures, signatures and type arguments), one block each - its type parameters with their
 * constraints and defaults, then one member per line, or its definition; unions in sorted order, named types by their
 * names. A member added, removed or retyped anywhere in that graph changes it. Written by the TypeScript checker: an
 * upgrade of TypeScript may write it otherwise.
 */
function sharedShape(): string {
	const config = ts.readConfigFile(`${PACKAGE_ROOT}/tsconfig.vitest.json`, ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT)
	const program = ts.createProgram({
		rootNames: [SHARED_TYPES],
		options: { ...parsed.options, noEmit: true, composite: false, incremental: false },
	})
	const checker = program.getTypeChecker()
	const source = program.getSourceFile(SHARED_TYPES)!
	// the file's own types as it exports them, the ones it imports as their aliases
	const known = [
		...checker.getExportsOfModule(checker.getSymbolAtLocation(source)!),
		...checker.getSymbolsInScope(source, ts.SymbolFlags.Alias),
	]
	const pending = SHARED_TYPE_NAMES.map(function rootOf(typeName) {
		const symbol = known.find(function named(candidate) {
			return candidate.name === typeName
		})
		if (!symbol) throw new Error(`${typeName} is neither declared nor imported in ${SHARED_TYPES}`)
		return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
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
		if (named && declaredInPackage({ symbol: named })) {
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
			return type.types
				.map(function memberWritten(member) {
					return written({ type: member, flags })
				})
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
	return `${blocks.sort().join('\n\n')}\n`
}

describe('what copies of the library share through the sqlite registration', () => {
	it(
		'its shape → the one recorded for SQLITE_STORAGE_VERSION (a changed shape: bump the version, its file is written at the next run; never rewrite one)',
		async () => {
			await expect(sharedShape()).toMatchFileSnapshot(
				shapeFileOf({ version: SQLITE_STORAGE_VERSION }),
			)
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})
