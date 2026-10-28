const LINK_PATTERN = /\{@link(?:code|plain)?\s+([^\s|}]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g

/** `{@link X}` → `` `X` ``, `{@link X | label}` → `label`: JSDoc links as the index shows them. */
export function renderLinks(text: string): string {
	return text.replace(LINK_PATTERN, function rendered(_match, target: string, label: string) {
		return label.trim() ? label.trim() : `\`${target}\``
	})
}
