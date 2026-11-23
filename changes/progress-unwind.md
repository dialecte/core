### Fixed

- A failed operation no longer leaves a stale progress bar. A `deepClone` that throws pops its own progress plan (and any plan a hook left open inside it), so a body that catches the error goes on with the bar it had before the clone. `doc.prepare` clears progress when its body throws, and a prepared `commit()` clears it when it ends, as `doc.transaction` does. A prepared transaction that is committed (successfully or not) or discarded now also ends with progress cleared, even when the prepare body left its own plan open.
