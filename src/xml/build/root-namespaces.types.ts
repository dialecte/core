/**
 * The namespaces of one written document, as a value: one prefix per namespace (`''` = the default namespace), one
 * namespace per prefix, all declared on the written root. A registration gives a new table and leaves the old one as
 * it was. The one exception to one prefix per namespace: the dialecte's default namespace takes a second prefix
 * (`alias`) for what cannot be written unprefixed in it.
 */
export type NamespaceTable = {
	/** The namespace each used prefix names: the scope in force below the root. */
	readonly bindings: ReadonlyMap<string, string>
	/** The prefix each used namespace is written with, in the order they were registered. */
	readonly prefixByUri: ReadonlyMap<string, string>
	/**
	 * The prefixes a namespace of the engine holds whether used or not (the dialecte's, `xsi`, `xs` for XSD, `xml`,
	 * `xmlns`): another namespace never takes one, so the choice does not depend on what is written first.
	 */
	readonly reserved: ReadonlySet<string>
	/** Whether XSD is written `xs`: the dialecte does not use `xs` itself. */
	readonly xsdTakesXs: boolean
	/** The number the next generated prefix (`ns<k>`) tries first. */
	readonly nextGenerated: number
	/**
	 * Whether the written root binds the default namespace: not when the root itself is in no namespace, where each
	 * default-namespace element below declares `xmlns` on itself.
	 */
	readonly defaultOnRoot: boolean
	/** The prefix bound to the dialecte's default namespace, once something needs one. */
	readonly alias: string | undefined
}

/** A registration's answer: the prefix the namespace is written with, and the table that holds it. */
export type NamespaceRegistration = {
	table: NamespaceTable
	prefix: string
}
