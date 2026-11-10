import { fileURLToPath } from 'node:url'

import { createXmlAssertions } from './index'
import { TEST_ENTRY_COMPILE_TIMEOUT_MS } from './test-timing.constants'

import ts from 'typescript'
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest'

import type { XmlAssertions, XmlQueriesParams, XmlQueriesWithNamespacesParams } from './index'

const TEST_ENTRY_FOLDER = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')
const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')

/**
 * The test entry compiled as a consumer's declaration build sees it: only `src/test/index.ts` as a root (or
 * another module of the entry's folder, `entry`, for the scan's own cases).
 */
function createTestEntryProgram(params: { entry?: string } = {}): ts.Program {
	const entry = params.entry ?? `${TEST_ENTRY_FOLDER}/index.ts`
	// compiled once per entry for the whole file: a program is only read, never changed, by a case
	const compiled = COMPILED_PROGRAMS.get(entry)
	if (compiled) return compiled
	const configPath = `${PACKAGE_ROOT}/tsconfig.vitest.json`
	const config = ts.readConfigFile(configPath, ts.sys.readFile)
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT)
	const program = ts.createProgram({
		rootNames: [entry],
		options: { ...parsed.options, noEmit: true, composite: false, incremental: false },
	})
	COMPILED_PROGRAMS.set(entry, program)
	return program
}

/** How many nested instances of one generic the scan reads the members of on one path. */
const GENERIC_REENTRY_CAP = 3

/** Each entry's program, compiled at its first use in the file. */
const COMPILED_PROGRAMS = new Map<string, ts.Program>()

afterAll(function releasePrograms() {
	COMPILED_PROGRAMS.clear()
})

/** The symbols that are a declared type: an alias, an interface, a class, an enum (not a type parameter or a member). */
const DECLARED_TYPE_FLAGS =
	ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.Enum

/** The types the test dialecte's generator writes: the entry's own fixtures, not a public parameter. */
function isGenerated(symbol: ts.Symbol): boolean {
	return symbol.declarations?.[0]?.getSourceFile().fileName.includes('/test/generated/') ?? false
}

/** A named type of the package outside the test entry: what a consumer imports from the package's own entry. */
function isNamedOutsideTestEntry(type: ts.Type): boolean {
	const symbol = type.aliasSymbol ?? type.getSymbol()
	const declaration = symbol?.declarations?.[0]
	if (!symbol || !declaration) return false
	if (symbol.name === '__type' || symbol.name === '__object') return false
	return !declaration.getSourceFile().fileName.startsWith(`${TEST_ENTRY_FOLDER}/`)
}

/** The generic a type instantiates (its alias, or its interface or class), when it is one. */
function genericOf(type: ts.Type): ts.Symbol | undefined {
	if (type.aliasSymbol && type.aliasTypeArguments?.length) return type.aliasSymbol
	return isTypeReference(type) && (type.target.typeParameters?.length ?? 0) > 0
		? type.target.symbol
		: undefined
}

/** A generic instance (`Array<X>`, `Promise<X>`): its type arguments are read through the checker. */
function isTypeReference(type: ts.Type): type is ts.TypeReference {
	return (
		(type.flags & ts.TypeFlags.Object) !== 0 &&
		((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
	)
}

/** The names of the types declared in the test entry that a type reaches (an alias, an interface, a class). */
function collectTestEntryTypeNames(params: {
	checker: ts.TypeChecker
	type: ts.Type
	seen: Set<ts.Type>
	names: Set<string>
	/** How many instances of each generic the current path is inside. */
	expanding?: ReadonlyMap<ts.Symbol, number>
}): void {
	const { checker, type, seen, names } = params
	if (seen.has(type)) return
	seen.add(type)
	// the test dialecte's generated types are fixtures generated from its schema: they name no type of the test entry,
	// and walking them (every element of the schema) is most of the scan's time
	const own = type.aliasSymbol ?? type.getSymbol()
	if (own && isGenerated(own)) return
	const generic = genericOf(type)
	// an instance met again with the same arguments is the same type (`seen`); one with other arguments is
	// read again (`Recursive<number>` holding `Recursive<string>`), up to a few levels: a generic that
	// expands on every level (`Tree<T>` holding `Tree<T[]>`) is a new type each time, and only its type
	// arguments are read past the cap
	const depth = generic ? (params.expanding?.get(generic) ?? 0) : 0
	const repeated = depth >= GENERIC_REENTRY_CAP
	const expanding =
		generic && !repeated
			? new Map([...(params.expanding ?? []), [generic, depth + 1]])
			: params.expanding
	// a named type of elsewhere (Promise, Array, Record) is not read, its type arguments are
	const typeArguments = [
		...(type.aliasTypeArguments ?? []),
		...(isTypeReference(type) ? checker.getTypeArguments(type) : []),
	]
	if (isNamedOutsideTestEntry(type)) {
		for (const argument of typeArguments)
			collectTestEntryTypeNames({ checker, type: argument, seen, names, expanding })
		return
	}
	for (const symbol of [type.aliasSymbol, type.getSymbol()]) {
		if (symbol && symbol.flags & DECLARED_TYPE_FLAGS && !isGenerated(symbol)) names.add(symbol.name)
	}
	// a generic's arguments are read even when its members never use them (a phantom parameter)
	const parts = [
		...(type.isUnionOrIntersection() ? type.types : []),
		...typeArguments,
		...type.getProperties().map((property) => checker.getTypeOfSymbol(property)),
		...[type.getStringIndexType(), type.getNumberIndexType()].filter(
			(indexType): indexType is ts.Type => indexType !== undefined,
		),
		...(type.isTypeParameter()
			? [type.getConstraint(), type.getDefault()].filter(
					(bound): bound is ts.Type => bound !== undefined,
				)
			: []),
		...type
			.getCallSignatures()
			.flatMap((signature) => [
				signature.getReturnType(),
				...signature.getParameters().map((parameter) => checker.getTypeOfSymbol(parameter)),
				...(signature.getTypeParameters() ?? []),
			]),
	]
	for (const part of repeated ? typeArguments : parts)
		collectTestEntryTypeNames({ checker, type: part, seen, names, expanding })
}

/** Each exported function of the entry with the test-entry types its signatures name. */
function listExportedFunctionTypes(program: ts.Program): {
	functions: Map<string, string[]>
	exported: Set<string>
} {
	const checker = program.getTypeChecker()
	const [entry] = program.getRootFileNames()
	const source = program.getSourceFile(entry)
	const moduleSymbol = source && checker.getSymbolAtLocation(source)
	if (!source || !moduleSymbol) throw new Error(`${entry} has no module symbol`)
	const exports = checker.getExportsOfModule(moduleSymbol)
	const functions = new Map<string, string[]>()
	for (const exported of exports) {
		const symbol =
			exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
		const type = checker.getTypeOfSymbolAtLocation(symbol, source)
		const signatures = type.getCallSignatures()
		if (signatures.length === 0) continue
		const names = new Set<string>()
		// the function's own type: its signatures, their parameters, return types and type parameters
		collectTestEntryTypeNames({ checker, type, seen: new Set(), names })
		functions.set(exported.name, [...names].sort())
	}
	return { functions, exported: new Set(exports.map((exported) => exported.name)) }
}

describe('the public types of the test entry', () => {
	it(
		'every test-entry type named in the signature of an exported function is itself exported',
		() => {
			const { functions, exported } = listExportedFunctionTypes(createTestEntryProgram())

			const offenders = [...functions].flatMap(([name, types]) =>
				types.filter((type) => !exported.has(type)).map((type) => `${name}: ${type}`),
			)
			expect(offenders).toEqual([])
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)

	it(
		'the scan sees the functions a dialecte re-exports',
		() => {
			const { functions } = listExportedFunctionTypes(createTestEntryProgram())

			expect(functions.get('createXmlAssertions')).toEqual(
				expect.arrayContaining(['XmlAssertions', 'XmlQueriesParams']),
			)
			expect(functions.get('assertExpectedElementQueries')).toEqual(
				expect.arrayContaining(['XmlQueriesWithNamespacesParams']),
			)
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('the scan of the test entry reads through generics', () => {
	it(
		'a non-exported type reached only through an array, a Promise or a Record → named by the scan',
		() => {
			const { functions } = listExportedFunctionTypes(
				createTestEntryProgram({ entry: `${TEST_ENTRY_FOLDER}/fixtures/test-entry-scan.ts` }),
			)

			expect(Object.fromEntries(functions)).toEqual({
				indexHiddenRows: ['HiddenRow'],
				listHiddenRows: ['HiddenRow'],
				loadHiddenRow: ['HiddenRow'],
			})
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('the scan of the test entry reads every type shape', () => {
	it(
		'a non-exported type reached through an index signature, a type parameter constraint or default, a generic of the entry → named by the scan',
		() => {
			const { functions } = listExportedFunctionTypes(
				createTestEntryProgram({
					entry: `${TEST_ENTRY_FOLDER}/fixtures/test-entry-scan-shapes.ts`,
				}),
			)

			expect(Object.fromEntries(functions)).toEqual({
				boxShapeRow: ['Box', 'ShapeRow'],
				emptyShapeRows: ['ShapeRow'],
				indexShapeRows: ['ShapeRow'],
				listShapeRowsByNumber: ['ShapeRow'],
				pickShapeRow: ['ShapeRow'],
				tagShapeRow: ['ShapeRow', 'Tagged'],
			})
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('the scan of the test entry at its edges', () => {
	it(
		"a non-exported type only in the constraint of the function's own type parameter → named by the scan",
		() => {
			const { functions } = listExportedFunctionTypes(
				createTestEntryProgram({
					entry: `${TEST_ENTRY_FOLDER}/fixtures/test-entry-scan-constraint.ts`,
				}),
			)

			expect(Object.fromEntries(functions)).toEqual({ constrainedRow: ['EdgeRow'] })
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)

	it(
		'a generic that expands on every level (Tree<T> holding Tree<T[]>) → the scan ends, naming it',
		() => {
			const program = createTestEntryProgram({
				entry: `${TEST_ENTRY_FOLDER}/fixtures/test-entry-scan-tree.ts`,
			})
			let functions: Map<string, string[]> = new Map()

			expect(() => {
				functions = listExportedFunctionTypes(program).functions
			}).not.toThrow()
			expect(Object.fromEntries(functions)).toEqual({ plantTree: ['Tree'] })
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('the scan of the test entry through self-referencing generics', () => {
	it(
		"a non-exported type only at a generic's second level (Recursive<number> holding Recursive<string>), alias and interface → named by the scan",
		() => {
			const { functions } = listExportedFunctionTypes(
				createTestEntryProgram({
					entry: `${TEST_ENTRY_FOLDER}/fixtures/test-entry-scan-recursive.ts`,
				}),
			)

			expect(Object.fromEntries(functions)).toEqual({
				startRecursive: ['DeepRow', 'Recursive'],
				startRecursiveInterface: ['DeepRow', 'RecursiveInterface'],
			})
		},
		TEST_ENTRY_COMPILE_TIMEOUT_MS,
	)
})

describe('a dialecte re-exporting the query assertions of the test entry', () => {
	it('types its functions with the public types, as scl does', () => {
		const assertions: XmlAssertions = createXmlAssertions({ namespaces: {} })
		const assertExpectedElementQueries: XmlAssertions['assertExpectedElementQueries'] =
			assertions.assertExpectedElementQueries
		const parameters: XmlQueriesParams = { xml: '<Root/>', queries: ['/Root'] }
		const withNamespaces: XmlQueriesWithNamespacesParams = { ...parameters, namespaces: {} }

		expectTypeOf(assertExpectedElementQueries).parameter(0).toEqualTypeOf<XmlQueriesParams>()
		expect(() => assertExpectedElementQueries(withNamespaces)).not.toThrow()
	})
})
