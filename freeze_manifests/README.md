# Freeze Manifests

Freeze IDs use design plus local timestamp:

`<scope>_<design>_<YYYYMMDD_HHMM>`

Rules:

- A frozen run must have a manifest before any API replay.
- A manifest locks git head, code hashes, runner hashes, data hashes, config hashes, source hashes, and the exact command.
- Use `git.head_policy: "ancestor_ok_with_hashes"` when the manifest itself is committed after the approved code baseline; the guard then requires that baseline to be an ancestor and still enforces exact hashes for every locked file.
- A frozen run must pass `scripts/analysis/freeze_guard.js` before running.
- Existing historical freezes may use `dirty_policy: "key_hash_locked_legacy"` when the original accepted state was `HEAD + archived patch`.
- New freezes should use a clean commit and `dirty_policy: "clean_commit_required"`.
- Any mechanism change gets a new timestamped candidate ID. Do not mutate an existing freeze ID.
