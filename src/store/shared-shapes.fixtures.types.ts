import type { ENGINE_WIRE_MEMBERS } from './engine/wire/wire.constants'

/** Named types a source file of the package declares or imports, the roots of a shared shape. */
export type SharedShapeRoot = {
	/** The file, from the package root (`src/store/...`). */
	file: string
	names: readonly string[]
}

/** A shared shape written out, and the files of the package declaring the types it holds. */
export type SharedShape = {
	text: string
	/** From the package root, `/`-separated, sorted. */
	declaredIn: string[]
}

/** What copies of the library of one version share, and the version guarding it. */
export type SharedShapeCase = {
	/** The constant bumped with any change of the shape, as the source names it. */
	versionName: string
	version: number
	/** The recorded file's name: `<recorded>-v<version>.txt`. */
	recorded: string
	roots: SharedShapeRoot[]
}

/** The wire table as copies of the library share it (how each member of the engine crosses a port): a shared root. */
export type EngineWireTable = typeof ENGINE_WIRE_MEMBERS

/** A type of the walk's own cases: a member whose union is open (a catalogue any string may extend). */
export type OpenUnionCase = {
	key: 'FIRST' | 'SECOND' | (string & {})
	closed: 'FIRST' | 'SECOND'
	optional?: 'FIRST' | (string & {})
	mixed: 'FIRST' | (string & {}) | { kind: 'object' } | 0
	branded: 'FIRST' | (string & { readonly brand: 'Id' })
}
