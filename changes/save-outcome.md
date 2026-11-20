### Added

- **An export says where its file went, and can save to a target opened before.** `project.export` and `project.exportBlob` asked to `download` answer `saved`: `written` (the file chosen in the save dialog), `downloaded` (a browser download: no dialog, or one refused for a lapsed gesture) or `cancelled` (the user cancelled the dialog, nothing written; the file is still answered). `openSaveTarget` is public in `@dialecte/core/utils`: open the dialog at the user's click, do the long work, then `export({ download: { target } })` writes there with no dialog of its own; a cancelled target lets the caller skip the work. `saveToDisk` answers its outcome.

### Changed

- **`saveToDisk` answers where the file went** (`SaveOutcome`) instead of nothing; a cancelled dialog answers `cancelled`. A write that fails after the dialog releases the chosen file and is thrown.
