# Tonen for Claude

[Tonen](https://tonen.app)'s plugin for Claude Code and Claude's apps lands
here with Tonen's next release: comments on your running site, fixed by
Claude, and `@Claude` in them heard by your Claude Code session.

Until then, connect Claude Code to Tonen's server:

```sh
claude mcp add --scope user --transport http tonen https://tonen.app/mcp && claude mcp login tonen
```

This repository is copied from what tonen.app serves (`scripts/sync.sh`,
every hour): its plugin is made in Tonen itself.
