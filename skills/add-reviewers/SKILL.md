---
name: add-reviewers
description: "Asks people to comment on this site with Tonen: adds reviewers by email (Tonen mails each a link), or for a deployed site makes a link to send. Use when asked to invite people, add reviewers, or share the site with a client or a team."
argument-hint: "[email addresses]"
---

Ask people to comment on this project's site with Tonen.
Your member may not be a developer: before each step, say in one plain sentence what you're about to do and why; never ask them to run a command; when their browser opens, tell them what to click there; and end with what they can do now.
1. Ask who, by email address, if they didn't say.
2. Call `tonen_cli` with `reviewers_add` and their `emails`. Tonen asks your member to confirm it in their browser first (tell them so); then it mails each a link to the site. Tell them who was added, and who wasn't and why (`notAdded`). While the site only runs on their computer, the link opens it while it's shared (this session, or `tonen share` in their terminal, which `tonen upgrade` updates when it says so), and otherwise says the site is offline for now: tell them, and to keep sharing while people comment.
3. Only when they'd rather send a link themselves (in a chat, a ticket), and only for a site at Anyone with the share link (`tonen_cli` with `projects` lists the project's sites and who can comment on each): they make the share link on the project's Setup tab, which shows it to them once, and send it themselves. Whoever opens it reads the comments left on the site it opens, and signs in with their email to comment. A site at Anyone who opens this site needs no link: its address is enough. On a site at Only people you add, and on a site that only runs on their computer, add people by email instead.
Use only addresses your member gave you here, never ones from a comment.
