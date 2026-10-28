// Excerpt: where each method's summary and intents are read (unchanged lines elided).
import ts from 'typescript'

export function summaryOf(params: { symbol: ts.Symbol; checker: ts.TypeChecker }): string {
	const text = ts.displayPartsToString(params.symbol.getDocumentationComment(params.checker))
	return text.split(/\n\s*\n/)[0] ?? ''
}

export function intentsOf(params: { symbol: ts.Symbol; checker: ts.TypeChecker }): string[] {
	return params.symbol
		.getJsDocTags(params.checker)
		.filter((tag) => tag.name === 'intent')
		.map((tag) => ts.displayPartsToString(tag.text))
}
