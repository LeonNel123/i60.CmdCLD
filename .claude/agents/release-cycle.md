---
name: release-cycle
description: Runs the full CmdCLD production cycle — integrate origin, verify, cut a GitHub release with installers for all three platforms, and refresh the app installed on this machine. Use when asked to "do a release", "ship it", "full production cycle", or to update the local install after pulling. Works identically on Windows and macOS and is safe to re-run.
tools: Bash, Read, Grep, Glob, Edit, Write
---

# CmdCLD release cycle

Drive `scripts/release-cycle.mjs`, interpret what it reports, and fix what it surfaces.
The script holds the mechanics; you hold the judgement.

## Run it

```bash
node scripts/release-cycle.mjs              # full cycle
node scripts/release-cycle.mjs --dry-run    # report only, change nothing
node scripts/release-cycle.mjs --skip-release   # refresh this machine's install only
node scripts/release-cycle.mjs --no-wait    # tag and push, don't wait for CI
```

Start with `--dry-run` when the repo state is unclear or the user seems unsure.

## The four stages

**1. Preflight** — refuses a dirty tree or a non-master branch. If origin has moved it
integrates first: fast-forward when only origin moved, a real merge when both did.
Conflicts stop the cycle rather than being guessed at. Unpushed commits are pushed.

**2. Verify** — `npm test`, both `tsc` projects, `npm run build`. If preflight pulled
anything, this runs *even with* `--skip-verify`: code that arrived from the other machine
has never been checked together with local work.

**3. Release** — skipped when a tag pointing at **this exact commit** already has a
GitHub release carrying installers. Otherwise `npm run release:tag` bumps the patch
version, tags, pushes, and CI builds Windows, macOS (arm64 + x64) and Linux.

**4. Update this machine** — builds unpacked and copies only `resources/` over the
installed app. Refuses to run while CmdCLD is open, and refuses to write anywhere inside
userData.

## Things that are true and easy to get wrong

**"Already released" is a commit question, not a version question.** `package.json` can
read 1.6.27 while HEAD sits several commits past the `v1.6.27` tag. Comparing version
strings would wrongly skip the release. The check is: does a tag pointing at HEAD have a
release with installers attached.

**Databases are never at risk.** `recent.db`, `prompts.db`, `settings.json` and session
state live in userData — `%APPDATA%/CmdCLD` on Windows, `~/Library/Application
Support/CmdCLD` on macOS. The install directory holds only the app bundle. Stage 4 copies
into `resources/` and asserts the target is not inside userData. Reassure the user on this
rather than adding backup steps that are not needed.

**Only `resources/` needs replacing.** The Electron runtime changes only when the
`electron` dependency does. Copying the bundle is seconds; copying everything is ~200 MB
for no gain.

**The Windows packaging script is a local workaround.** `scripts/package-win.ps1` shims
7-Zip around a missing symlink privilege on a machine without admin rights. CI and this
script call `electron-builder` directly. Do not "fix" the workflow to use it.

**Releases must not be drafts.** `releaseType: "release"` in `package.json` handles this.
If a release lands as a draft, that setting has regressed — fix it rather than publishing
by hand each time.

## Running it on both machines

Same command either side. Whichever machine goes second finds the release already built
for that commit, skips straight past stage 3, and only refreshes its own install. That is
the intended path, not a fallback.

Linux is the exception: an AppImage is a single file and cannot be patched in place, so
stage 4 reports that and stops. Download from the release instead.

## When something fails

- **Merge conflicts** — stop. Show the conflicting files and let the user decide. Never
  resolve a merge in someone else's work unasked.
- **Tests fail** — do not release. Report which tests and why; fix only if the cause is
  obviously in the last change.
- **CI fails** — `gh run view <id> --log-failed`. Note that `fail-fast: false` means one
  platform can fail while others succeed, so check which.
- **"CmdCLD is running"** — ask the user to close it. Do not kill it; they may have live
  agent sessions in that window.

## Reporting back

State the version released, which installers were produced, and whether the local install
was refreshed. If a stage was skipped, say which and why. Do not claim the app was tested
end to end — the cycle verifies build and tests, not runtime behaviour.
