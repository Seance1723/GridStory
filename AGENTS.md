# GridStory repository instructions

These instructions apply to the entire repository.

## Mandatory project ledgers

Every change to the application must update the project ledgers in the same change set:

1. `TASKS.md`
   - Move the relevant task to `[~]` before or while implementing it.
   - Mark it `[x]` only after the stated acceptance criteria have been verified.
   - Add a new stable task ID before doing unplanned work.
   - Never delete completed tasks; retain them as project history.
2. `CHANGELOG.md`
   - Record every user-visible, architectural, operational, security, test, or documentation change under `Unreleased`.
   - Use the Keep a Changelog categories: Added, Changed, Deprecated, Removed, Fixed, Security.
3. `BUGS.md`
   - Log every defect found during testing before fixing or deferring it.
   - Give each bug a stable `BUG-####` ID and link it to its task/changelog entry.
   - Move resolved bugs to the resolved table; never erase them.

A code change is not complete when any required ledger update is missing.

## Status notation

- `[ ]` planned
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked, with the blocking reason written next to the task

## Engineering rules

- Preserve the framework-neutral control-plane boundary.
- Keep browser, server, and React Server Component entry points explicit.
- Never allow preview credentials or draft content into published caches.
- Tenant scope must be explicit in storage, API, cache, event, and audit contracts.
- Run the proportionate type, unit, integration, build, and browser checks before marking work complete.
- Prefer small vertical slices that remain runnable over broad unfinished scaffolding.

