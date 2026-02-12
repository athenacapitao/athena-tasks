# Phase 3: Git Permission Issue

**Date:** 2026-02-11
**Problem:** ui.html ownership/staging issue with git

## Symptoms

When running git commands with `workdir` parameter:
- File `ui.html` was owned by `athena:athena` (uid/gid 3910)
- Git reported "nothing to commit, working tree clean" even though `ls` showed the file
- `git add ui.html` had no output and didn't stage the file
- `git ls-files` showed `ui.html` as tracked
- `git diff` showed nothing

## Root Cause

Likely a git index caching issue or file ownership quirk when using the `workdir` parameter in the exec tool. The file existed and had correct permissions (`rw-rw-r--`), but git's internal index wasn't recognizing it as modified.

## Resolution

After several `getfacl` and `chown` attempts:
- File permissions appeared correct throughout (`user::rw-`)
- Eventually `git status` properly recognized the file as modified
- Successfully committed with message: "P3-02: CSS foundation — Dark theme and variables"

## Prevention

Always use `workdir` parameter for git commands:
```bash
git add <file> && git commit -m "message"
```

If staging fails, check:
1. `git status --short` - to see what git sees
2. `git ls-files | grep <file>` - to verify file is tracked
3. `getfacl <file>` - to check permissions
4. If file appears modified to `ls` but not to `git`: try `git add -f <file>`
