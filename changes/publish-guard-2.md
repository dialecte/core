### Fixed

- The push to main never publishes a version at or below npm's latest: a lower or equal version (a downgrade, a typo such as `0.0.8` after `0.8.0`) fails the publish run with the reason, and a version npm already has is never published again. A first publish (npm answers E404) publishes. The decision lives in `scripts/publish-guard/run-publish-decision.ts`, run by `_check-npm-version.yml`.
- A failed npm or git lookup fails the publish run with npm's or git's reason (`npm view --json`; only a success or an E404 counts as an answer), instead of being hidden and read as "npm does not have it".
- A pre-release version (one holding `-`) is published under the `next` dist-tag, never as `latest`.
- A release tag that is missing for a version npm has is recovered: a re-run of the version-changing push pushes the tag alone, without publishing, when npm's dist-tag for the version names it.
- `_publish.yml` and `_tag-release.yml` are called by `publish.yml` only (no `workflow_dispatch`, which skipped the guard).
- `_check-npm-version.yml` says what a merge-queue batch does: its head is published, so the ruleset keeps the queue at one entry per merge.
