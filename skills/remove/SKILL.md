---
name: remove
description: "Takes Tonen out of this site: its script tag, its CSP sources and the team's plugin settings."
disable-model-invocation: true
---

Take Tonen out of this project's site.
1. Remove Tonen's script tag (the one with `data-project="proj_…"`) from the pages, and the sources it added to a Content-Security-Policy (`install` lists them).
2. Remove Tonen from this repository's .claude/settings.json if it's there: `extraKnownMarketplaces.tonen` and `enabledPlugins["tonen@tonen"]`.
3. Tell me what you removed. The project and its comments stay on Tonen: its owners delete it on its Members tab, and Claude Code's plugin goes with `claude plugin uninstall tonen@tonen`.
Ask me before changing anything else.
