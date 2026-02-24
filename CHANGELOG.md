# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.19] - 2026-02-24

### Changed

- allow file export with database ids

## [0.0.18] - 2026-02-24

### Changed

- dependencies update

## [0.0.17] - 2026-02-24

### Changed

- `createDialecte` is now synchronous — root element creation is deferred to the first `fromRoot()` call

## [0.0.16] - 2026-02-17

### Fixed

- `goToElement`: we do not get the last state with updated element for singletons (element without id)
  -> fetch last staged operations for every element before database

## [0.0.15] - 2026-02-16

### Added

- `findDescendantsAsTree`: wrapper around `findDescendants` to get a tree record instead of a flatten result
- testing `pyodide` for the generation script - still wip

### Changed

- `findDescendants`: in between elements are optional if not specified with attributes, and collected if present

### Fixed

- `create` method hook integration: set the focus on the right updated parent

## [0.0.14] - 2026-02-02

### Changed

- extract `extensions` from the configuration to avoid circular type references issues
- expose tagName explicitly in the core methods, to expose the right methods in the chain at runtime

## [0.0.13] - 2026-02-02

### Changed

- allow partial attribute on `update` method (globally)

## [0.0.12] - 2026-02-02

### Changed

- `FindDescendantsReturn`: narrow down unfiltered `findDescendants` results

## [0.0.11] - 2026-02-02

### Added

- `AnyTreeRecord` type

### Fixed

- right chain ending focus on `deepCloneChild` with setFocus parameter

## [0.0.10] - 2026-01-30

### Fixed

- `beforeClone` hook implementation in the `deepCloneChild` method

## [0.0.9] - 2026-01-30

### Added

- `beforeClone` hook added to the clone method

## [0.0.8] - 2026-01-30

### Added

- `getAttributesValues`: new chain method to get currentFocus attributes values

## [0.0.7] - 2026-01-29

### Changed

- allow partial attribute on `update` method

## [0.0.6] - 2026-01-29

### Added

- `withDownload` parameter on `exportFile` with native Api support and fallback to be able to download a file

## [0.0.5] - 2026-01-29

### Changed

- export `ExtensionMethods` type

## [0.0.4] - 2026-01-28

### Added

- io: select an extension from the `supportedExtensions` list of the `dialecteConfig` at file export.

### Changed

- `xmlElements` in favor of `sclElements` for the `xmlElements` tableName in the `dialecteConfig` (legacy support reasons)

## [0.0.3] - 2026-01-28

### Fixed

- add proper type narrowing support to findDescendants
- fix the tests

## [0.0.2] - 2026-01-28

### Added

- add pipelines to lint, format, check, publish and tag

## [0.0.1] - 2026-01-28

### Added

- methods: chainable (mutations and navigation) and non chainable (endings)
- database: create a Dexie database instance (indexedDB)
- io: file import and export to IndexedDB
- dialecte: create a new core dialecte
- script: generate definition and split it up to constants based on XSD
