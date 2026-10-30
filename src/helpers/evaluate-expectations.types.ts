/** The elements an expectation is about: a tag, and the attribute values they must hold. */
export type ExpectationScope = {
	tag: string
	/** Attribute values, each one value or any of several - as `findByAttributes` matches them. */
	where?: Record<string, string | string[]>
}

/**
 * What a document should hold, said before a script writes it: elements of a tag, optionally with
 * attribute values, optionally anywhere under an element of another tag. With `count`, exactly that
 * many (0: none); without, at least one.
 */
export type Expectation = ExpectationScope & {
	under?: ExpectationScope
	count?: number
}

/** An expectation the document does not meet: how many elements it holds, and why that fails. */
export type ExpectationFailure = {
	expectation: Expectation
	actualCount: number
	message: string
}

/** What `evaluateExpectations` answers: every expectation, met or not, in the order given. */
export type ExpectationsOutcome = {
	passed: Expectation[]
	failed: ExpectationFailure[]
}

/** What `evaluateExpectations` is given beside the query. */
export type EvaluateExpectationsParams = {
	expectations: readonly Expectation[]
}
