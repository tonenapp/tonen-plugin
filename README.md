# Tonen for Claude

[Tonen](https://tonen.app) lets people comment on your running site, each
comment pinned to the element it's about, and lets Claude fix what they ask.
This plugin brings Tonen into Claude Code and Claude's apps.

## Install

In Claude Code, in the terminal:

```sh
claude plugin marketplace add tonenapp/tonen-plugin
claude plugin install tonen@tonen
```

Then open your site's folder in Claude Code and say what you want, in your
own words: "let my client comment on this site". Claude sets it up, shares
your dev server, and opens your browser when Tonen needs you to sign in or
confirm something. Nothing to type in the terminal.

Fixing comments and hearing @Claude use Tonen's own connection for Claude,
so people see Claude's work as Claude's: the first time, sign in with `/mcp`
(Tonen, then Authenticate), or `claude mcp login plugin:tonen:tonen` in the
terminal. If you connected Tonen before with `claude mcp add`, remove that
connection first (`claude mcp remove tonen`): Claude Code keeps it and hides
the plugin's. In the desktop app's Code tab or the editor extensions, add the
marketplace `tonenapp/tonen-plugin` under Plugins, then install Tonen.

In Claude on the web, the desktop app or your phone: Customize, Plugins, Add
marketplace, `tonenapp/tonen-plugin`, then install Tonen and connect it on its
Connectors tab.

## What you get

- **`/tonen:setup`** adds Tonen to your site: a project, named in a small
  `tonen.json` your team commits, Tonen's script tag in your pages (on
  localhost too, so a teammate who runs the site sees the bar), who can
  comment on each address, which Claude asks you, your confirm in the
  browser of each deployed address, and your dev server shared so people
  comment on it from anywhere. It also adds Tonen to the repository's
  Claude Code settings, so your team installs it with
  `claude plugin install tonen@tonen`.
- **`/tonen:add-reviewers`** asks people to comment: by email (Tonen mails
  each a link, once you confirm it in your browser), or, for a site at
  Anyone with the share link, a link you make on the project's Setup tab
  and send yourself.
- **`/tonen:fix`** works through the comments one at a time: it finds the
  element in your code, fixes it, checks it, and tells the reviewer what
  changed.
- **@Claude on your site.** In Claude Code, in a repository with Tonen
  (its `tonen.json` or script tag), Claude listens for you while you work (anywhere else,
  ask Claude to listen, and it does so in the background): mention `@Claude`
  in a comment, and it answers in the thread, or asks you in Claude Code before
  it changes anything. A line above the prompt says when it listens and how
  many comments are left to fix. Ask Claude to stop listening, and it does. Listening needs Claude Code; Claude's other apps
  read and answer comments when you ask.
- **Your dev server, shared.** In Claude Code on macOS or Linux, ask Claude to
  share your site's dev server (say, localhost:5173): the people its setting
  on the project's Setup tab lets in then open it from anywhere and comment
  on it, while your session runs (at first your project's members and
  reviewers, and anyone with the local site's own share link, which you
  make there). A line above the prompt shows the address and how many
  people viewed it. Ask Claude to stop sharing, and it does.
- **Tonen's helper.** Setup, invites and sharing run the Tonen CLI for you.
  The first time, Claude Code asks you, downloads it into `~/.tonen/bin` and
  checks it, and your browser opens for you to sign in. Anything only you
  may do (sharing for the first time, adding reviewers, a share link) waits
  for your Confirm on Tonen. The helper updates with the plugin; a `tonen`
  you installed in your terminal updates with `tonen upgrade`.
- **`/tonen:remove`** takes Tonen out of your site.

## What it may do without asking

Listening calls two of Tonen's tools, `projects` and `wait_for_mention`, so the
plugin lets those two run without a permission prompt, and its own
`stop_listening`, `share_local_site` and `stop_sharing` (sharing asks you
itself, for each port it hasn't shared in that session), and `tonen_cli`,
which runs the Tonen CLI for your errands (Tonen asks you in the browser for
what only you may do). Every other tool asks as usual. Comment text is treated as a request about your site, never as
instructions to Claude.

## Remove it

```sh
claude plugin uninstall tonen@tonen
claude plugin marketplace remove tonen
```
