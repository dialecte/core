### Added

- `SaveTarget.discard()`, on every target `openSaveTarget` answers: gives the target up when the file will not be written. The browser may create the chosen file, empty, as the save dialog closes; `discard()` removes it while it is empty (`FileSystemFileHandle.remove()`, where the browser has it; elsewhere it does nothing), so a picked file that holds content is kept. A download or a cancelled target has nothing to remove. Once a write succeeded, `discard()` does nothing (the saved file is the user's); one during a write waits for it; concurrent ones settle together; a write to a file or download target after it is refused with `SAVE_TARGET_DISCARDED` (`D7032`). A file already gone counts as removed; any other failure to remove it is thrown, and the next `discard()` tries again.

### Changed

- `SaveTarget` has a required `discard()` on every member: a target a caller builds itself (a wrapper, a test fake) adds one, `async () => {}` when it has nothing to undo.

### Fixed

- `project.export` and `project.exportBlob` with `download: true` or `{ filename }` no longer leave an empty file behind when they fail after opening the save dialog: they discard the dialog they opened (where the browser can remove the file), then throw the export's failure. A `{ target }` the caller passed is left to the caller.
