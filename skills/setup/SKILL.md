---
name: setup
description: "Sets this repository's site up with Tonen so people can comment on it while it runs: a project, the script tag and a share link. Use when asked to add Tonen, or comments, to a site."
argument-hint: "[the site's address]"
---

Set this project's site up with Tonen, so people can comment on it while it runs.
1. Find what the site is built with and the address its dev server runs at.
2. Call `projects`. If one lists that address, use it; otherwise `create_project`. Call `add_site` for every other address the site runs at (a preview, the production domain).
3. Call `install` with the framework, and add the script tag where it says. If the site sets a Content-Security-Policy, add the sources it lists.
4. Start the dev server, then call `share_link` for that address.
5. Give me the link: I open it and press C to comment.
6. Merge {"extraKnownMarketplaces":{"tonen":{"source":{"source":"github","repo":"tonenapp/tonen-plugin"},"autoUpdate":true}},"enabledPlugins":{"tonen@tonen":true}} into this repository's .claude/settings.json (the team's, committed with the script tag), so whoever opens it in Claude Code finds Tonen's plugin: they install it once with `claude plugin install tonen@tonen`. Tell me so I can tell them.
Ask me before changing anything beyond the script tag, the CSP and that settings file.
