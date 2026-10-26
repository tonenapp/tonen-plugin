import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";
import { offerAutoUpdate } from "./auto-update.ts";
import { registerCliTool, reportBranch, runCliTool } from "./cli.ts";
import { CLI_TOOL } from "./cli-tool.ts";
import { shareArgsOf, sharingLine, stopArgsOf } from "./local-site.ts";
import {
  registerSharing,
  SHARE,
  shareLocalSite,
  sharingSection,
  STOP_SHARING,
  stopAll,
  stopSharing,
} from "./share.ts";
import { hand, handUnsent, showStatus } from "./status.ts";
import {
  type Answer,
  backgroundsTooSoon,
  checkedOutIn,
  countsIn,
  delayAfter,
  listeningLine,
  TAG_PATTERN,
  looksLikeSite,
  ownProject,
  readAnswer,
  projectIdOf,
  projectOfConfig,
  projectsIn,
} from "./listen.ts";

// Tonen's plugin for Claude Code: it listens for the member's mentions
// (@Claude) for the whole session and hands each one to the session as a
// turn of its own, so no wait holds up their session. It starts by itself in
// a repository whose pages load Tonen's bar for one of the member's projects,
// and whenever Claude calls `wait_for_mention` (the member asked it to
// listen): the plugin takes that call over and listens in the background
// instead. While it listens, a dim band above the prompt says so; Claude Code
// draws a plugin's status line as a warning (⚠), so only what needs the
// member goes there.
//
// It holds Tonen's `wait_for_mention` itself, through the session's own
// connection to Tonen (the server .mcp.json lists, or the same server added by
// hand: the engine runs one). `via: "plugin"` makes Tonen answer in JSON for
// the plugin and leave listening out of the prompt. The mention reaches the
// model framed as the plugin's message, never as the member's own words: it
// was typed on a website.
//
// It also shares the member's dev server as a project's local site when Claude
// calls `share_local_site` (share.ts, which runs the Tonen CLI's `tonen
// share`); the band shows each one shared. And it tells Tonen which branch
// the repository has checked out (`tonen branch`), as the session starts and
// whenever a turn of its listening sees it change, so the member's localhost
// and local site show that branch's comments.

/** The server's key in .mcp.json. */
const SERVER = "tonen";
/**
 * The names Tonen's server may run under: the plugin's own, or the same
 * server added by hand as `tonen`. hooks.json lets the plugin's calls through
 * on these alone.
 */
const SERVER_NAMES = ["plugin:tonen:tonen", "tonen"];
/** What the model calls Tonen's wait under, on either name. */
const WAIT_TOOLS = ["mcp__plugin_tonen_tonen__wait_for_mention", "mcp__tonen__wait_for_mention"];
/** The plugin's own tool, which Claude calls when its member asks it to stop listening. */
const STOP = "stop_listening";
/** After Tonen refused a call (a project left, a grant taken away), how long until it tries again. */
const REFUSED_RETRY_MS = 5 * 60_000;

// What the plugin listens on: one project, or all of the member's (`projectId`
// undefined), and which loop is the current one, so a new target ends the
// old loop at its next turn. A reload of the module starts it over, as it
// cancels its timers.
let target: { projectId: string | undefined; loop: number } | undefined;
let loops = 0;
// Whether this session may still ask about the plugin's updates: an
// interactive one, once, after its first turn (auto-update.ts).
let mayOfferUpdates = false;

// The project whose checked-out branch the plugin reports: the one the
// repository's tonen.json names, else its only script tag's, else the
// member's own among its tags once Tonen lists them.
let repoProject: string | undefined;
// What the plugin last told Tonen the repository has checked out, in memory
// only: each session reports again as it starts (another session or
// computer of the member's may have reported another branch since), and so
// does a reload of the module, which Tonen takes as the same report.
let reported: { projectId: string; branch: string } | undefined;
// A report under way: the next turn doesn't start a second.
let reporting = false;

// What the band draws (types/index.d.ts): set while listening, null otherwise.
const band = atom({ plugin: "tonen", key: "band" } as const, null);
// The local sites shared, one band line each, which share.ts writes.
const sharing = atom({ plugin: "tonen", key: "sharing" } as const, []);

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    // The session's state outlives a reload of the module; what it said
    // before is only true once listening starts again.
    await update($, band, () => null);
    if (!e.isInteractive) return started;
    // Sharing asks the person first, so it's only for a session with one.
    await registerSharing($);
    await registerCliTool($);
    await $.tool.register({
      name: STOP,
      description:
        "Stops Tonen's plugin listening for your member's mentions (@Claude) in this session. Call it when your member asks you to stop listening.",
    });
    mayOfferUpdates = true;
    const here = await projectsHere($);
    const candidates = here.all;
    repoProject = here.named ?? (candidates.length === 1 ? candidates[0] : undefined);
    reported = undefined;
    if (candidates.length === 0) {
      await offerSetup($);
      return started;
    }
    $.clock.after(0, () => void reportCheckedOut($));
    if (backgroundsTooSoon(await $.env.get("CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS"))) {
      await warn($, "remove CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS from your settings to hear @Claude");
      return started;
    }
    $.clock.after(0, () => void start($, candidates, 0));
    return started;
  });

  // The plugin's own tools answer here: share_local_site and stop_sharing
  // (share.ts), and stop_listening.
  //
  // Claude asked to listen (the member said so, or a prompt did): the plugin
  // listens in the background instead, on what Claude asked for, and answers
  // at once, so the session stays free. Only where the plugin would listen
  // itself: with a setting that backgrounds its calls too soon, Claude's own
  // call goes through as ever.
  on("tool.call", async ($, e, next) => {
    if (e.tool === `mcp__tonen__${CLI_TOOL}`) {
      const text = await runCliTool($, e, next.signal);
      return { result: [{ type: "text", text }] };
    }
    if (e.tool === `mcp__tonen__${SHARE}`) {
      const args = shareArgsOf(e);
      if (typeof args === "string") return { deny: args };
      const text = await shareLocalSite($, args.port, args.projectId, next.signal);
      return { result: [{ type: "text", text }] };
    }
    if (e.tool === `mcp__tonen__${STOP_SHARING}`) {
      const args = stopArgsOf(e);
      if (typeof args === "string") return { deny: args };
      return { result: [{ type: "text", text: stopSharing($, args.port) }] };
    }
    if (e.tool === `mcp__tonen__${STOP}`) {
      await stopListening($);
      return {
        result: [
          {
            type: "text",
            text: "Tonen's plugin stopped listening for your member's mentions in this session. Tell your member; they can ask you to listen again.",
          },
        ],
      };
    }
    if (!WAIT_TOOLS.includes(e.tool)) return next(e);
    if (backgroundsTooSoon(await $.env.get("CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS"))) return next(e);
    const projectId = projectIdOf(e);
    // A project the member isn't on (a test fixture's tag, someone else's)
    // would only be refused later, with nothing listening meanwhile: Claude
    // hears it now, and whatever listened goes on.
    if (projectId && !(await mayListenOn($, projectId))) {
      return {
        deny: `${projectId} isn't one of your member's Tonen projects (\`projects\` lists them). Call wait_for_mention with one of theirs, or without projectId to listen on all of them.`,
      };
    }
    if (!target || target.projectId !== projectId) await startListening($, projectId);
    return {
      result: [
        {
          type: "text",
          text: `Tonen's plugin now listens in the background for your member's mentions (@Claude) on ${where(projectId)}, and hands each one to you as a message of its own. Tell your member it's listening, and carry on: don't call wait_for_mention again. When they ask you to stop, call ${STOP}.`,
        },
      ],
    };
  });

  // Claude learns what the plugin shares (`sharingSection`), so it doesn't
  // run tonen share itself, and that it listens, so it never calls
  // wait_for_mention or asks its member to run /mcp__tonen__listen.
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    const shared = sharingSection();
    const sections = shared
      ? [...composed.sections, { id: "tonen:sharing", scope: "session" as const, text: shared }]
      : composed.sections;
    if (!target) return { ...composed, sections };
    return {
      ...composed,
      sections: [
        ...sections,
        {
          id: "tonen:listening",
          scope: "session",
          text: `Tonen's plugin listens for your member's mentions (@Claude) on ${where(target.projectId)} in this session and hands each one to you as a message of its own. Don't call wait_for_mention, offer /mcp__tonen__listen, or set CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS. When your member asks you to stop listening, call ${STOP}.`,
        },
      ],
    };
  });

  // The session's end stops what it shares; a /clear doesn't (the band and
  // the next conversation's prompt still say it's shared).
  on("session.end", async ($, e, next) => {
    if (e.reason !== "clear") stopAll($);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const completed = await next(e);
    handUnsent($);
    if (mayOfferUpdates && e.agentId === undefined) {
      mayOfferUpdates = false;
      $.clock.after(0, () => void offerAutoUpdate($));
    }
    return completed;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const now = await read($, band);
    const shared = await read($, sharing);
    if ((now === null && shared.length === 0) || e.props.hasSurvey) return next(e);
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {now === null ? null : <Text dimColor>{listeningLine(now.toFix)}</Text>}
        {shared.map((row) => (
          <Text dimColor>{sharingLine(row)}</Text>
        ))}
      </Box>
    );
  });
};

/** Where the plugin listens, in words for Claude. */
function where(projectId: string | undefined) {
  return projectId ? `Tonen project ${projectId}` : "all of their Tonen projects";
}

// Says what needs the member, in the status line (⚠), and takes the band down.
async function warn($: EngineInterface, text: string) {
  await update($, band, () => null);
  showStatus($, "listen", text);
}

// Listens on `projectId` (all of the member's projects when undefined) from now
// on, in a loop of its own; any loop before it ends at its next turn, and
// the band starts over, so it never shows another project's count.
async function startListening($: EngineInterface, projectId: string | undefined) {
  loops += 1;
  const loop = loops;
  target = { projectId, loop };
  await update($, band, () => null);
  $.clock.after(0, () => void listen($, loop, 0));
}

// Stops listening: the current loop ends at its next turn, and the band and
// status line go quiet.
async function stopListening($: EngineInterface) {
  target = undefined;
  await update($, band, () => null);
  showStatus($, "listen", undefined);
}

// Whether `projectId` is one of the member's projects. True when Tonen can't say
// now: listening then finds out, and says so.
async function mayListenOn($: EngineInterface, projectId: string): Promise<boolean> {
  const tonen = await $.mcp.connect(SERVER);
  if (!tonen.isConnected) return true;
  const listed = await projectsText($, tonen.server);
  return listed === undefined || ownProject([projectId], listed) !== undefined;
}

// Finds which of the repository's projects is the member's own, once Tonen
// answers, then listens on it. Quiet when none is (a test fixture's tag,
// someone else's project): Claude can still listen when the member asks.
async function start($: EngineInterface, candidates: readonly string[], failures: number) {
  const tonen = await $.mcp.connect(SERVER);
  if (!tonen.isConnected) {
    await notConnected($, tonen.reason);
    $.clock.after(delayAfter(failures + 1), () => void start($, candidates, failures + 1));
    return;
  }
  // The same server added by hand under another name runs in its place, and
  // the plugin's calls to it would each ask for permission.
  if (!SERVER_NAMES.includes(tonen.server)) {
    await warn(
      $,
      `Tonen is also added as ${tonen.server}: remove it (claude mcp remove ${tonen.server}) to hear @Claude`,
    );
    return;
  }
  const listed = await projectsText($, tonen.server);
  if (listed === undefined) {
    $.clock.after(delayAfter(failures + 1), () => void start($, candidates, failures + 1));
    return;
  }
  showStatus($, "listen", undefined);
  const project = ownProject(candidates, listed);
  if (project && repoProject === undefined) {
    repoProject = project;
    void reportCheckedOut($);
  }
  if (project && !target) await startListening($, project);
}

async function notConnected($: EngineInterface, reason: string) {
  await warn(
    $,
    reason === "auth" ? "sign in with /mcp to hear @Claude" : `not connected (${reason})`,
  );
}

// One held call at a time: each ends with a mention, or when Tonen says to
// call again (every 100 s at most), and the next starts at once; a failure
// waits a little longer each time, up to a minute. The band's count of
// comments to fix is read again before each, and the repository's branch
// reported when it changed. A loop that is no longer the current one stops
// at its next turn.
async function listen($: EngineInterface, loop: number, failures: number) {
  if (!target || target.loop !== loop) return;
  const { projectId } = target;
  void reportCheckedOut($);
  const again = (ms: number, failed: number) =>
    $.clock.after(ms, () => void listen($, loop, failed));
  const tonen = await $.mcp.connect(SERVER);
  if (!tonen.isConnected) {
    await notConnected($, tonen.reason);
    again(delayAfter(failures + 1), failures + 1);
    return;
  }
  const listed = projectId ? await projectsText($, tonen.server) : undefined;
  const counts = listed === undefined || !projectId ? undefined : countsIn(listed, projectId);
  showStatus($, "listen", undefined);
  await update($, band, (was) => ({ toFix: counts?.toFix ?? was?.toFix ?? 0 }));
  let answer: Answer;
  try {
    answer = readAnswer(
      await $.mcp.call(tonen.server, "wait_for_mention", {
        ...(projectId ? { projectId } : {}),
        via: "plugin",
      }),
    );
  } catch {
    answer = { kind: "failed" };
  }
  // A loop that was replaced or stopped while its call was held still hands
  // over a mention it got (it is the member's), then ends, saying nothing.
  const current = target?.loop === loop;
  if (!current && answer.kind !== "mention") return;
  switch (answer.kind) {
    case "mention":
      // Seen also from another window: the system's notification, as the
      // member chose in Claude Code's settings.
      await $.ui.notify(answer.notice, { title: "Tonen" }).catch(() => undefined);
      await hand($, answer.prompt);
      if (current) again(0, 0);
      return;
    case "waiting":
      again(0, 0);
      return;
    case "restarting":
      again(5_000, 0);
      return;
    case "replaced":
      // Nothing listens here any more: Claude may listen itself again.
      if (target?.loop === loop) target = undefined;
      await warn($, "stopped listening: Tonen listens in 5 sessions at most");
      return;
    case "refused":
      // Tonen said no (it says why): say so, and try again much later.
      await warn($, answer.message.split("\n")[0] ?? answer.message);
      again(REFUSED_RETRY_MS, 0);
      return;
    case "failed":
      // Tonen didn't answer (a restart, a dropped connection): soon again.
      await warn($, "can't reach Tonen, trying again");
      again(delayAfter(failures + 1), failures + 1);
      return;
    case "stopped":
      await warn($, "can't listen right now, trying again");
      again(delayAfter(failures + 1), failures + 1);
      return;
  }
}

/** The text of Tonen's `projects`: the member's projects, one a line. Undefined when it failed. */
async function projectsText($: EngineInterface, server: string): Promise<string | undefined> {
  try {
    const listed = await $.mcp.call(server, "projects");
    if (listed.isError) return undefined;
    return listed.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
  } catch {
    return undefined;
  }
}

/**
 * The Tonen projects this session's repository names (`all`): its tonen.json's
 * (`named`) first, then its tracked files' script tags. Empty in a folder
 * without Tonen.
 */
async function projectsHere(
  $: EngineInterface,
): Promise<{ named: string | undefined; all: string[] }> {
  // tonen.json at the repository's root (the session's folder outside git),
  // then the script tags in the whole repository (`:/`), wherever in it the
  // session started.
  const root = (await git($, ["rev-parse", "--show-toplevel"]))?.trim() ?? (await $.session.cwd());
  const named = projectOfConfig(await $.fs.read(`${root}/tonen.json`).catch(() => undefined));
  const found = await git($, ["grep", "-h", "-o", "-I", "-E", TAG_PATTERN, "--", ":/"]);
  const tagged = found === undefined ? [] : projectsIn(found);
  return { named, all: [...new Set([...(named ? [named] : []), ...tagged])] };
}

// Tells Tonen the branch the repository has checked out when it isn't the
// one last reported. Nothing on a detached HEAD, nor before the plugin knows
// the repository's project. It never asks the person anything: a report that
// fails (no helper yet, not signed in, Tonen down) goes to the debug log, and
// the next turn tries again.
async function reportCheckedOut($: EngineInterface) {
  const projectId = repoProject;
  if (reporting || projectId === undefined) return;
  reporting = true;
  try {
    const head = await git($, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = head === undefined ? undefined : checkedOutIn(head);
    if (branch === undefined) return;
    if (reported?.projectId === projectId && reported.branch === branch) return;
    const result = await reportBranch($, projectId);
    if ("failed" in result) {
      $.ui.log(`Tonen's plugin couldn't report branch ${branch}: ${result.failed}`, {
        to: "debug",
      });
      return;
    }
    // What git said here, which the next turn compares against: the CLI
    // read the same HEAD (or a newer one, which the next turn reports again).
    reported = { projectId, branch };
  } catch (error) {
    $.ui.log(`Tonen's plugin couldn't report the branch: ${String(error)}`, { to: "debug" });
  } finally {
    reporting = false;
  }
}

// In a website's repository without Tonen, says once where to start, then
// never again for that repository.
async function offerSetup($: EngineInterface) {
  const root = await git($, ["rev-parse", "--show-toplevel"]);
  if (root === undefined) return;
  const key = `offered:${root.trim()}`;
  if ((await $.store.get(key)) !== undefined) return;
  const files = await git($, ["ls-files", "--", ":/"]);
  if (files === undefined || !looksLikeSite(files)) return;
  await $.store.set(key, true);
  $.ui.toast("/tonen:setup lets people comment on this site while it runs", {
    timeoutMs: 10_000,
  });
}

/** What `git <args>` printed in the session's directory; undefined when it failed or isn't a repository. */
async function git($: EngineInterface, args: string[]): Promise<string | undefined> {
  try {
    const ran = await $.process.run(["git", ...args], { timeoutMs: 10_000 });
    return ran.exitCode === 0 ? ran.stdout : undefined;
  } catch {
    return undefined;
  }
}
