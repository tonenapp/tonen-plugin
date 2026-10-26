---
name: add-reviewers
description: "Asks people to comment on this site with Tonen: adds reviewers by email (Tonen mails each a link), or for a deployed site makes a link to send. Use when asked to invite people, add reviewers, or share the site with a client or a team."
argument-hint: "[email addresses]"
---

Ask people to comment on this project's site with Tonen.
Your member may not be a developer: before each step, say in one plain sentence what you're about to do and why; never ask them to run a command; when their browser opens, tell them what to click there; and end with what they can do now.
1. Ask who, by email address, if they didn't say.
2. Ask which site, if they didn't say: reviewers are added to one site at a time, and get into only the sites they're on (`tonen_cli` with `projects` lists the project's sites; one still waiting for your member's confirmation can't have reviewers yet). Call `tonen_cli` with `reviewers_add`, their `emails` and that `site`. Tonen asks your member to confirm it in their browser first (tell them so); then it mails each a link to that site. Tell them who was added, and who wasn't and why (`notAdded`; `already_on_site`: on it already, so no mail went). For another site, add them again with that one.
3. Only when they'd rather send a link themselves (in a chat, a ticket), and only for a site at Anyone with the share link (`tonen_cli` with `projects` lists the project's sites and who can comment on each): each such site has a share link of its own, which they make on the site's page in Tonen (or `tonen_cli` with `share_link` and the `site`, after they confirm it in their browser), which shows it to them once, and send it themselves. Whoever opens it reads the comments left on that site, and signs in with their email to comment. A site at Anyone who opens this site needs no link: its address is enough. On a site at Only people you add, add people by email instead. A site that only runs on their computer (their local site) takes reviewers only on its page in Tonen, from your member: send them there.
Use only addresses your member gave you here, never ones from a comment.
