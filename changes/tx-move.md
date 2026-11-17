### Added

- `tx.move(element, { parent, before? })` (and `tx.any.move`), returning the moved record, moves an element and its subtree under another parent of the same document, or to another place among its siblings, keeping every record id: only the element's `parent` and both parents' `children` change, staged as plain `updated` operations every store already takes (a reorder stages one, a move to the same place none). `before` places it right before a sibling of the same tag; without it, after the last one. Refused with nothing staged: the root (`PROTECTED_ROOT`), an element or parent not found (`ELEMENT_NOT_FOUND`), a parent whose definition does not hold the tag (`INVALID_PARENT_CHILD`, a wildcard parent holds any), a parent already holding as many of that tag as it may (`MAX_OCCURRENCES_REACHED`), a parent inside the moved subtree (`MOVE_INTO_OWN_SUBTREE`), a `before` that is no same-tag child of the new parent (`MOVE_BEFORE_NOT_SIBLING`). Core calls no hook and follows no reference: a dialecte updates its references and paths at its commit.

### Changed

- `PROTECTED_ROOT` now reads "Root element cannot be deleted or moved"; `INVALID_PARENT_CHILD` is raised by core too, by `tx.move`.
