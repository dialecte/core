---
type: fix
---

The SQLite engine sweeps attribute indexes when it starts: index tables whose record table is gone, and an index
missing any of its tables or triggers, are removed (triggers first), so no file state left by an older version or a
tool can make a write to a document fail. Pinned as well: the index never refuses a write from any path, a connection
that registers nothing included; a build refused for space stays on the filtered answer and resumes at the next start;
no build runs while an import does; and the store never runs a full `VACUUM`, which could renumber the record rows the
index points at.
