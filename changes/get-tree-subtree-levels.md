### Changed

- `getTree` on an element below the document root (a ref with an `id`) reads only that element's subtree, one read per level, even with no `select`, `omit` or `depth`; it no longer reads the whole document. The trees are the same. The document root, or a ref without `id`, with nothing to prune still reads the whole document once.
