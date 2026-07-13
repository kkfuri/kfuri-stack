# kfuri-stack

Diego's personal Claude Code skills. Formerly a fork of gstack, stripped down to just the skills.

## Skills

- **kfuri-pair** — pair-programming judgement gate: decides act / recommend / ask, and forces the "am I done, or should I make this better?" refactor checkpoint before declaring done.
- **kfuri-review** — triages the review conversation on a PR: fixes clear bot findings, resolves nits silently, defers anything with human participation. Never posts comments.

## Install

Symlink each skill into `~/.claude/skills/`:

```bash
ln -snf "$PWD/kfuri-pair" ~/.claude/skills/kfuri-pair
ln -snf "$PWD/kfuri-review" ~/.claude/skills/kfuri-review
```
