# kfuri-stack

Diego's personal Claude Code skills. Formerly a fork of gstack, stripped down to just the skills.

## Skills

- **kfuri-pair** — pair-programming judgement gate: decides act / recommend / ask, and forces the "am I done, or should I make this better?" refactor checkpoint before declaring done.
- **kfuri-review** — local, read-only code review on demand: reviews the diff with the focus you ask for, reports findings in chat. Never comments, commits, or touches GitHub.

## Install

Symlink each skill into `~/.claude/skills/`:

```bash
ln -snf "$PWD/kfuri-pair" ~/.claude/skills/kfuri-pair
ln -snf "$PWD/kfuri-review" ~/.claude/skills/kfuri-review
```
