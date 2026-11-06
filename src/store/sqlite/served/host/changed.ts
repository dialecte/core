/** A member answered that it changed something (a member that says nothing of it did). */
export function changed(params: { value: unknown }): boolean {
	return params.value !== false
}
