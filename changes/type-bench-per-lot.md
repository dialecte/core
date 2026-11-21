### Changed

- The type bench measures each change against the base it goes onto, fresh, and stores nothing: the committed type-bench baseline is gone, and the release gate no longer runs the type bench (CI runs it on every pull request and merge-queue run, handing it the change's base). A change more than 5% over its base explains the cost with a `- Type cost: <why>` line in its changelog fragment instead of re-baselining. The contributor guide and the `dialecte-contributing` skill say so.
