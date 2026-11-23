### Fixed

- An IndexedDB commit or bulk write whose store reloaded its connection meanwhile (a second open of the store at once, a schema reloaded after another tab's import) no longer fails with "Invalid table argument": every write - a commit, a bulk write, an undo, a redo, a removal - now takes all the tables it writes through from the connection current as its transaction starts, and its history head and version are read and written in that transaction's own `_meta`.
