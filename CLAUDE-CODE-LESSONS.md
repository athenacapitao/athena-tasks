# Claude Code Best Practices & Lessons Learned

## Python exec Pattern - CRITICAL

**ALWAYS use `-c` flag for inline Python code. NEVER use `-m` flag for module names.**

**The Mistake (Feb 10, 2026):**
```bash
# ❌ WRONG - will fail
python3 -m "import sys; data = json.load(sys.stdin); print(data.get('homepageUrl'))"

# ✅ CORRECT - use -c for inline code
python3 -c "import sys; data = json.load(sys.stdin); print(data.get('homepageUrl'))"
```

**Why it happened:** 
- `-m` flag imports Python modules by name
- When you pass a full Python script string as a quoted argument, Python tries to find a MODULE named `"import sys; ..."` (doesn't exist)
- `-c` flag runs string as Python code directly

**Rule:** For inline Python code in exec tool, ALWAYS use `-c`.

**For Python modules (json.tool):**
```bash
# Use -m with actual module name
python3 -m json.tool input.json

# NOT -c
# This will fail: python3 -c "import json.tool; json.tool.load(sys.stdin)"
```

# Claude Code Best Practices & Lessons Learned

## CRITICAL RULE: ALWAYS PUSH TO GITHUB

**RULE:** After EACH complete task by Claude Code, you MUST push changes to GitHub.

**Process:**
1. Verify task completion
2. Commit changes: `git add -A && git commit -m "[task name] - Complete"`
3. Push to GitHub: `git push origin main`

**Why:** Every task completion must be backed up to GitHub immediately. No exceptions.

---

## Critical Success Factors

### 1. ONE TASK AT A TIME
**Always:** Give Claude Code only ONE specific task with clear deliverables.
**Never:** Try to give multiple tasks or phases at once.

**Why it works:** Claude Code stays focused and doesn't get overwhelmed.

### 2. PROVIDE COMPLETE CONTEXT
Every task must include:
- **Task Description** - What needs to be done
- **Steps** - Specific commands or actions to take
- **Acceptance Criteria** - Clear checklist of what "done" looks like
- **Technical Notes** - Constraints, libraries, patterns to use

### 3. WAIT FOR COMPLETION
**Rule:** Never give next task until current one is fully complete and verified.

### 4. MANUAL VERIFICATION
After Claude Code completes a task, ALWAYS verify:
- Files were created/modified correctly
- Permissions are correct
- Content matches specifications
- The system is in expected state

### 5. BE PATIENT WITH APPROVALS
Claude Code will ask for approvals for:
- Reading files
- Executing bash commands
- Writing/overwriting files
- Installing packages

Always review the command carefully, then approve. Never skip approvals.

---

## Workflow for Using Claude Code

### Step 1: Prepare the Task
Write detailed task description using template below.

### Step 2: Submit Task to Claude Code
```bash
claude
# Then in session:
> write
[paste task description]
```

### Step 3: Wait and Approve
- Review each command carefully
- Approve with "1" and Enter
- Wait for completion

### Step 4: Verify Results
Manually check that everything was done correctly.

### Step 5: Push to GitHub (CRITICAL)
After EVERY task completion:
```bash
# Commit changes
git add -A
git commit -m "Task PXX-YY - [Brief description]"

# Push to GitHub
git push origin main
```

### Step 6: Move to Next Task
Only after verification AND push are successful, prepare next task.

---

## Common Issues and Solutions

### Issue: Claude Code Gets Stuck in Loops
**Cause:** Too much context or unclear instructions.
**Solution:** Break down task into smaller pieces. Clear context and start fresh.

### Issue: File Write Errors
**Cause:** File already exists or permission issues.
**Solution:** Let Claude Code handle overwrite. Check permissions manually.

### Issue: Commands Fail Silently
**Cause:** Wrong directory or missing dependencies.
**Solution:** Always verify current directory before running commands.

### Issue: GitHub Push Fails
**Cause:** Network issues, merge conflicts, or auth problems.
**Solution:** Check git status, resolve conflicts, verify git remote.

---

## Best Practices Summary

1. **ALWAYS** push to GitHub after EVERY task completion (CRITICAL)
2. **ALWAYS** start with Foundation/Phase 1 tasks
3. **ALWAYS** verify after each task
4. **ALWAYS** use task template
5. **ALWAYS** include technical notes and constraints
6. **ALWAYS** be patient with approvals
7. **Never** rush or skip verification
8. **Never** give multiple tasks at once
9. **Never** overwhelm Claude Code with context
10. **Never** skip GitHub push (CRITICAL)

---

## When to Use Claude Code vs. Manual Commands

### Use Claude Code For:
- Creating files from scratch
- Writing complex code
- Creating server.js with full API
- Building UI components
- Setting up project structure

### Use Manual Commands For:
- Quick verification checks
- Simple file operations
- Git operations (commit, push)
- Package installation when Claude Code fails
- Pushing to GitHub after task completion

---

## Success Indicators

You're using Claude Code correctly when:
- ✅ Each task completes successfully
- ✅ Verification always passes
- ✅ GitHub push happens after EVERY task
- ✅ No manual fixes needed
- ✅ Project progresses smoothly

---

## References

- **Main lessons document:** `/home/athena/.openclaw/workspace/CLAUDE-CODE-LESSONS.md`
- **GitHub skill:** `/home/athena/.openclaw/workspace/skills/github/SKILL.md`
- **This skill:** `/home/athena/.openclaw/workspace/skills/claude-code/SKILL.md`

---

## Last Updated

- **Date:** 2026-02-10 22:20 UTC
- **Fix:** Added Python exec pattern to prevent -m/-c mistakes
