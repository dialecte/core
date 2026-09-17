/**
 * Format an XML string to a canonical, readable shape: one structural tag per line, indented by depth,
 * with pure-text leaves kept inline (`<Name ...>text</Name>`).
 *
 * NON-VALIDATING and tolerant of `${...}` template interpolations (treated as opaque characters), so it
 * works on XML embedded in JS/TS template literals — where a `${templateUuid}` interpolation can stand
 * for a whole attribute, which a real XML parser silently mis-parses. It only rewrites the insignificant
 * whitespace *between* elements: attribute text and leaf text are preserved verbatim, and an element with
 * mixed text + element content is emitted with its original inner content untouched, so no significant
 * value is ever altered. Idempotent.
 */
export function formatXml(
	source: string,
	options: { indent?: string; baseIndent?: string } = {},
): string {
	const indent = options.indent ?? '\t'
	const baseIndent = options.baseIndent ?? ''
	const nodes = parseNodes(tokenize(source.trim()))
	const lines: string[] = []
	for (const node of nodes) printNode(node, baseIndent, indent, lines)
	return lines.join('\n')
}

type Token =
	| { type: 'open'; name: string; raw: string }
	| { type: 'close'; name: string; raw: string }
	| { type: 'selfclose'; name: string; raw: string }
	| { type: 'comment'; raw: string }
	| { type: 'other'; raw: string } // <!DOCTYPE ...>, <?xml ...?>
	| { type: 'text'; raw: string }

type XmlNode =
	| { kind: 'element'; name: string; openRaw: string; selfClosing: boolean; children: XmlNode[] }
	| { kind: 'text'; raw: string }
	| { kind: 'comment'; raw: string }
	| { kind: 'other'; raw: string }

function tagName(raw: string, start: number): string {
	let k = start
	while (k < raw.length && !/[\s/>]/.test(raw[k]!)) k++
	return raw.slice(start, k)
}

/** Split into tags and text runs. Respects quotes so a `>` inside an attribute value never ends a tag. */
function tokenize(input: string): Token[] {
	const tokens: Token[] = []
	let i = 0
	while (i < input.length) {
		if (input[i] === '<') {
			if (input.startsWith('<!--', i)) {
				const end = input.indexOf('-->', i + 4)
				const stop = end === -1 ? input.length : end + 3
				tokens.push({ type: 'comment', raw: input.slice(i, stop) })
				i = stop
				continue
			}
			if (input[i + 1] === '!' || input[i + 1] === '?') {
				const end = input.indexOf('>', i)
				const stop = end === -1 ? input.length : end + 1
				tokens.push({ type: 'other', raw: input.slice(i, stop) })
				i = stop
				continue
			}
			let j = i + 1
			let quote: string | undefined
			while (j < input.length) {
				const c = input[j]
				if (quote) {
					if (c === quote) quote = undefined
				} else if (c === '"' || c === "'") quote = c
				else if (c === '>') break
				j++
			}
			const stop = j < input.length ? j + 1 : input.length
			const raw = input.slice(i, stop)
			i = stop
			if (raw[1] === '/') tokens.push({ type: 'close', name: tagName(raw, 2), raw })
			else if (raw.endsWith('/>')) tokens.push({ type: 'selfclose', name: tagName(raw, 1), raw })
			else tokens.push({ type: 'open', name: tagName(raw, 1), raw })
			continue
		}
		const next = input.indexOf('<', i)
		const stop = next === -1 ? input.length : next
		tokens.push({ type: 'text', raw: input.slice(i, stop) })
		i = stop
	}
	return tokens
}

/** Build a node tree. Tolerant of imbalance — an unmatched close simply ends the current element. */
function parseNodes(tokens: Token[]): XmlNode[] {
	let pos = 0
	const parseChildren = (): XmlNode[] => {
		const children: XmlNode[] = []
		while (pos < tokens.length) {
			const token = tokens[pos]!
			if (token.type === 'close') return children
			pos++
			if (token.type === 'open') {
				const element: XmlNode = {
					kind: 'element',
					name: token.name,
					openRaw: token.raw,
					selfClosing: false,
					children: parseChildren(),
				}
				if (tokens[pos]?.type === 'close') pos++ // consume the matching close
				children.push(element)
			} else if (token.type === 'selfclose') {
				children.push({
					kind: 'element',
					name: token.name,
					openRaw: token.raw,
					selfClosing: true,
					children: [],
				})
			} else {
				children.push({ kind: token.type, raw: token.raw })
			}
		}
		return children
	}
	return parseChildren()
}

/** Reconstruct a node's exact source (used to emit mixed content verbatim). */
function rawOf(node: XmlNode): string {
	if (node.kind !== 'element') return node.raw
	if (node.selfClosing) return node.openRaw
	return `${node.openRaw}${node.children.map(rawOf).join('')}</${node.name}>`
}

function printNode(node: XmlNode, indentStr: string, unit: string, out: string[]): void {
	if (node.kind === 'text') {
		if (node.raw.trim() !== '') out.push(indentStr + node.raw.trim())
		return
	}
	if (node.kind === 'comment' || node.kind === 'other') {
		out.push(indentStr + node.raw.trim())
		return
	}
	if (node.selfClosing) {
		out.push(indentStr + node.openRaw)
		return
	}

	const close = `</${node.name}>`
	const hasElementChildren = node.children.some((child) => child.kind !== 'text')
	const hasSignificantText = node.children.some(
		(child) => child.kind === 'text' && child.raw.trim() !== '',
	)

	if (!hasElementChildren) {
		// text-only leaf (or empty): keep inline, text verbatim
		const text = node.children.map((child) => (child.kind === 'text' ? child.raw : '')).join('')
		out.push(indentStr + node.openRaw + text + close)
		return
	}

	if (hasSignificantText) {
		// mixed content: emit the original inner verbatim so no significant text value changes
		out.push(indentStr + node.openRaw + node.children.map(rawOf).join('') + close)
		return
	}

	// pure-element container: one child per line, insignificant whitespace text dropped
	out.push(indentStr + node.openRaw)
	for (const child of node.children) {
		if (child.kind === 'text') continue
		printNode(child, indentStr + unit, unit, out)
	}
	out.push(indentStr + close)
}

/**
 * Reformat every XML snippet embedded in a JS/TS source string — a template literal preceded by a
 * `/* xml *\/` marker comment — with {@link formatXml}, re-indented under the marker's own line with the
 * closing backtick aligned to the statement. Leaves the rest of the source untouched. The reusable core
 * of an `xmlfmt`-style step for test fixtures (see the `dialecte-xmlfmt` bin).
 */
export function formatEmbeddedXml(sourceCode: string, options: { indent?: string } = {}): string {
	const indent = options.indent ?? '\t'
	const pattern = /^([ \t]*)(.*?\/\*\s*xml\s*\*\/[ \t]*)`([\s\S]*?)`/gm
	return sourceCode.replace(pattern, (_match, lineIndent: string, prefix: string, xml: string) => {
		const baseIndent = lineIndent + indent
		const formatted = formatXml(xml, { indent, baseIndent })
		// a trivial single-line snippet stays inline; a nested one breaks, closing backtick on its own
		// line aligned with the statement (the marker's own indent)
		if (!formatted.includes('\n')) return `${lineIndent}${prefix}\`${formatted.trim()}\``
		return `${lineIndent}${prefix}\`\n${formatted}\n${lineIndent}\``
	})
}
