### Fixed

- `findAncestors`, `findAncestorsOfEach`, `getTree` and `getSnapshot` unwrap a transparent element (or one `unwrap` names) only when it is in its own namespace, one the dialecte's definition declares for its tag. A same-name element in another namespace (`<other:AA_1 xmlns:other="urn:other">` where `AA_1` is transparent) was walked through or hoisted as if it were the dialecte's own; it is now a normal element: it stays in the ancestor chain and the tree, takes a `depth` level, can be the `stopAtTagName` element and gets no `select` pass-through. Answers for the dialecte's own transparent elements are unchanged, and `unwrap: []` still unwraps nothing.

### Added

- `declaredNamespaces({ dialecteConfig, tagName })` from `@dialecte/core/utils`: the namespaces a tag is declared in (its tag level and each declaration, once each); none for a tag the definition does not know.

### Changed

- `applyUnwrap` (internal, reachable from the package root) takes `unwrapSet`, built by `unwrapSetOf({ dialecteConfig, tagNames })`, instead of `unwrapTagNames`; `isUnwrapped`, `unwrapSetOf` and the `UnwrapSet` type are internal helpers of the same reads.
