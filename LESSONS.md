# Agent Lessons — 2026-02-11

## Critical Issue: Edit Tool Failing Repeatedly

### Problem
The `edit` tool for file modifications failed multiple times with:
```
Could not find exact text in /path/to/file. The old text must match exactly including all whitespace and newlines.
```

### Root Causes

1. **Race condition** — File being modified between read and edit
2. **Context drift** — Multiple edits in sequence change file structure
3. **Whitespace mismatch** — Tabs vs spaces, trailing spaces, line endings
4. **Short search patterns** — Common strings like `footer {` appearing multiple times

### Resolution Strategy

#### Better Approach for Edit Operations

1. **Use unique anchors** — Search for surrounding unique code/comments, not just common patterns
   ```javascript
   // BAD
   footer {
     // This appears 3+ times in the file
   }
   
   // GOOD
   // ── Mobile breakpoint ── */
   @media (max-width: 640px) {
     footer {
     }
   }
   ```

2. **Read larger context** — Get 20-30 lines before/after target to ensure exact match
   ```bash
   read offset=100 limit=40 path/to/file
   ```

3. **Use sed for simple replacements** — When edit fails:
   ```bash
   sed -i 's/old text/new text/g' file.html
   ```

4. **Verify state before each edit** — Read the file immediately before attempting edit
   ```bash
   # 1. Check line numbers
   grep -n "unique pattern" file.html
   
   # 2. Read exact context
   read offset=XXX limit=10 file.html
   
   # 3. Only then edit
   edit new="..." old="..." path=...
   ```

5. **Chain carefully** — If edit fails, stop and diagnose:
   - Read the file again
   - Check if previous edit succeeded
   - Find new line numbers
   - Adjust anchor strategy

### Specific Fix for This Session

**Failed edits attempted:**
- Header expansion (logo, nav, user)
- Footer expansion (stats, brand)
- CSS additions for header/footer

**Current state:** File has partial edits (filter bar is complete) but header/footer CSS incomplete.

**Next action:**
1. Read current file state completely
2. Find exact insertion points for header/footer CSS
3. Use sed for bulk CSS additions if needed
4. Verify with grep before committing

### Prevention Checklist

Before running `edit`:
- [ ] Read file to verify current state
- [ ] Use grep -n to find exact line number
- [ ] Include sufficient context in oldText (3-5 lines)
- [ ] Verify no conflicting edits pending
- [ ] If edit fails, read again before retrying

### Tools Preference Order

1. `edit` — For precise, small changes
2. `sed` — For bulk replacements or when edit fails
3. `write` — Only for complete file rewrites (last resort)
