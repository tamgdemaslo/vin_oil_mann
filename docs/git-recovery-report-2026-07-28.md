# Git recovery report — 2026-07-28

## Result

**PASS.** The working tree was backed up before `.git` repair. Git history and
the user's modified/untracked files were preserved. No reset, clean, garbage
collection, history rewrite, or deletion of working-tree files was performed.

## Independent backup

Backup location (outside the repository):

`/Volumes/KINGSTON/ТГМ/Эко-платформа/repository-before-git-repair-2026-07-28-codex-019fa778`

Verified artifacts:

- `source.tar.gz` — 530 MB; `gzip -t` and archive listing passed. It contains
  the working tree without `.git` and `node_modules`, including the local env
  files, and therefore must remain private and outside Git.
- `git-directory-copy.tar.gz` — 174 MB; created from a filesystem snapshot of
  `.git`; `gzip -t` and complete archive listing passed.
- `working-tree.diff`, `status.txt`, `modified-files.txt`, and
  `untracked-files.txt` were captured before repair.
- SHA-256 checksums are stored in `checksum.txt`.

The first two direct tar attempts against the live `.git` were retained as
diagnostic evidence but are not recovery sources: Codex checkpoint writes made
their tar listings inconsistent. The verified recovery source is
`git-directory-copy.tar.gz`.

## AppleDouble cleanup

- AppleDouble files found before repair: **16,907**.
- Files with a live counterpart: **16,572**; removed only after the counterpart
  check and backup verification.
- Orphan `._tmp_obj_*` files: **335**. Every file was exactly 4,096 bytes,
  identified by `file` as `AppleDouble encoded Macintosh file`, and had the
  AppleDouble magic `00051607`. Their paths were recorded before removal.
- AppleDouble files remaining in `.git`: **0**.

The complete classification is stored outside Git in
`appledouble-manifest.tsv` and
`appledouble-signature-confirmed-without-counterpart.txt`.

## Post-repair verification

- `git status --short --untracked-files=all`: works; **186** entries preserved.
- `git log --oneline -20`: works.
- `git diff --stat`: works.
- `git diff --check`: exit code **0**.
- `git fsck --full`: exit code **0**.
- Critical fsck findings (`missing`, `corrupt`, `bad sha1`, broken links): **0**.
- Informational unreachable objects: 3,419 dangling trees and 8 dangling
  blobs, consistent with local Codex checkpoint/history artifacts; no pruning
  was performed.

Post-repair fsck, status, log, and diff evidence is preserved in the independent
backup directory.

## Commit gate

Git health no longer blocks commits. Path-specific commits still require a
separate scope review because the working tree contains pre-existing product/UI
changes mixed with the branch-architecture work. `git add .` remains forbidden.
