---
name: release
description: Use when releasing a new version of 职页 — bumping the version, writing the release notes, creating the GitHub release, or when asked to "cut a release" / "release vX.Y.Z".
---

# Release 职页

One pipeline: version bump → release notes → PR → squash-merge → tag → GitHub release. The repository no longer
carries a published changelog, so the release notes are the only changelog: they live in the GitHub release.

## Steps

1. **Scope the release.** Previous tag: `git tag --sort=-creatordate | head -1`. Changes: `git log vPREV..HEAD --format='%h %s'`. Confirm the new version with the user if not given (patch unless there's a headline feature).
2. **If this cycle added user-facing strings**, run fill-translations first so catalogs ship complete.
3. **Bump the version** in the root `package.json`: it is the release version for the web app, server and GitHub release.
4. **Write the release notes** to `release-notes.md` in house style — use changelog-generator for the prose, then fit it to this exact shape:

   ```md
   ## Highlights

   - **Bold feature lead.** One or two sentences of user-facing benefit — what it does for the user, not how it's implemented. [abc123def](https://github.com/reactive-resume/reactive-resume/commit/abc123def)

   ## Thematic Section (e.g. Resume Builder, Import & Export, Self-Hosting & Maintenance)

   - Past-tense entry ("Added…", "Fixed…", "Improved…") with commit links. [abc123def](https://github.com/reactive-resume/reactive-resume/commit/abc123def)

   **Full Changelog**: [vPREV...vX.Y.Z](https://github.com/reactive-resume/reactive-resume/compare/vPREV...vX.Y.Z)
   ```

   Conventions: the release date is the tag's date, given ordinal ("7th July 2026") wherever it appears; every bullet links its commit(s) as `[shortsha](commit url)`; group by theme, Highlights first; write for users of the app and self-hosters, not for contributors. Thank external contributors by handle where relevant.

5. **Run checks**: `pnpm check`, `pnpm typecheck`, `pnpm test`.
6. **PR**: non-draft, against `main`. Before merging, tagging, publishing the release or pushing the Cloudron change, show the user exactly what will run (version, commit SHA, release notes) and wait for an explicit yes. Short summary + bullets of changes in the body. **No mention of Claude/Codex/AI anywhere in title, body, or commits.** Squash-merge once CI is green, then wait for the post-merge checks on `main` to pass (`gh pr checks --watch`, then watch the main run).
7. **Tag and release** from updated `main`:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title vX.Y.Z --notes-file release-notes.md
   ```

   Delete `release-notes.md` afterwards; it is not committed.

8. **Update the Cloudron package** once the release image is on GHCR: follow `cloudron/README.md` (manifest `version`, `CHANGELOG`, `npx cloudron versions add --image ghcr.io/reactive-resume/reactive-resume:v<version>`), then commit `cloudron/` to `main`.
9. **Optional, on request**: a LinkedIn/Reddit announcement draft based on the Highlights.

## Common Mistakes

| Mistake                                                       | Reality                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| Bumping versions in `packages/*`, `apps/web` or `apps/server` | Only the root `package.json` carries the release version.   |
| Committing `release-notes.md`                                 | The notes belong in the GitHub release, not the repository. |
| Implementation-speak in the release notes                     | Readers are end users and self-hosters; describe benefits.  |
| Tagging before the squash-merge lands                         | Tag the merged commit on `main`, never the branch.          |
| ISO dates in the notes                                        | House style is ordinal: "7th July 2026".                    |
