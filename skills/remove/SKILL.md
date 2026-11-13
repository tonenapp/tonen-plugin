---
name: remove
description: "Takes Tonen out of this site: its script tag, its CSP sources, tonen.json and the team's plugin settings."
disable-model-invocation: true
---

Take Tonen out of this repository's project.
Your member may not be a developer: before each step, say in one plain sentence what you're about to do and why; run commands for them when your tools support it; if a step requires their own terminal, explain why and give the exact command; when their browser opens, tell them what to click there; and end with what they can do now. Distinguish sign-in, installation in code, visibility on the running site and availability to others. For any pending step or failure, say what succeeded, what remains and who must act; give the returned link when browser confirmation is needed.
1. Remove Tonen's script tag (the one with `data-project="proj_…"`) from the pages, the sources it added to a Content-Security-Policy (`install` lists them), and tonen.json at the repository's root.
2. Remove Tonen from this repository's .claude/settings.json if it's there: `extraKnownMarketplaces.tonen` and `enabledPlugins["tonen@tonen"]`.
3. Tell me what you removed, and that a deployed address keeps the bar until the change is deployed there. The project and its comments stay on Tonen: its owners delete it on its Settings tab, and Claude Code's plugin goes with `claude plugin uninstall tonen@tonen`.
Ask me before changing anything else.
