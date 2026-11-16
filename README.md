# kfuri-stack

Diego's personal Claude Code skills. Formerly a fork of gstack, stripped down to just the skills.

## Skills

- **kfuri-review** — local, read-only code review on demand: reviews the diff with the focus you ask for, reports findings in chat. Never comments, commits, or touches GitHub.

## Install

Symlink each skill into `~/.claude/skills/`:

```bash
ln -snf "$PWD/kfuri-review" ~/.claude/skills/kfuri-review
```
