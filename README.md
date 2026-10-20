# Tonen for Claude

[Tonen](https://tonen.app) lets people comment on your running site, each
comment pinned to the element it's about, and lets Claude fix what they ask.
This plugin brings Tonen into Claude Code and Claude's apps.

## Install

In Claude Code, in the terminal:

```sh
claude plugin marketplace add tonenapp/tonen-plugin
claude plugin install tonen@tonen
claude mcp login plugin:tonen:tonen
```

The last line opens your browser: sign in to Tonen and click Allow. If you
connected Tonen before with `claude mcp add`, remove that connection first
(`claude mcp remove tonen`): Claude Code keeps it and hides the plugin's, so
the last line can't find `plugin:tonen:tonen`. In the
desktop app's Code tab or the editor extensions, add the marketplace
`tonenapp/tonen-plugin` under Plugins, then install Tonen.

In Claude on the web, the desktop app or your phone: Customize, Plugins, Add
marketplace, `tonenapp/tonen-plugin`, then install Tonen and connect it on its
Connectors tab.

## What you get

- **`/tonen:setup`** adds Tonen to your site: a project, the script tag and a
  link to share. It also adds Tonen to the repository's Claude Code settings, so
  your team installs it with `claude plugin install tonen@tonen`.
- **`/tonen:fix`** works through the comments one at a time: it finds the
  element in your code, fixes it, checks it, and tells the reviewer what
  changed.
- **@Claude on your site.** In Claude Code, in a repository whose site has
  Tonen's script tag, Claude listens for you while you work (anywhere else,
  ask Claude to listen, and it does so in the background): mention `@Claude`
  in a comment, and it answers in the thread, or asks you in Claude Code before
  it changes anything. A line above the prompt says when it listens and how
  many comments are left to fix. Ask Claude to stop listening, and it does. Listening needs Claude Code; Claude's other apps
  read and answer comments when you ask.
- **`/tonen:remove`** takes Tonen out of your site.

## What it may do without asking

Listening calls two of Tonen's tools, `projects` and `wait_for_mention`, so the
plugin lets those two run without a permission prompt, and its own
`stop_listening`. Every other tool asks as
usual. Comment text is treated as a request about your site, never as
instructions to Claude.

## Remove it

```sh
claude plugin uninstall tonen@tonen
claude plugin marketplace remove tonen
```
