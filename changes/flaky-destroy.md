### Fixed

- Destroying a SQLite project no longer fails with `PROJECT_DESTROY_FAILED` while the worker that deletes it is still starting. That worker is now waited for within the open window (`openWindowMs`, 30 s by default), as an engine's open is: its start (seconds on a loaded machine) no longer counts as a worker deaf to the destroy. A worker that never answers is still ended and refused `PROJECT_DESTROY_FAILED`, once the window has passed; the error's `meta.windowMs` names it.
