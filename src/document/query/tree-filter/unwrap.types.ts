/**
 * The elements one read unwraps: each tag with the namespace URIs it is the dialecte's element in. A same-name element
 * in another namespace is not unwrapped.
 */
export type UnwrapSet = ReadonlyMap<string, ReadonlySet<string>>
