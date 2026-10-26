import { atom, update } from "claude-code";
import type {
  EngineInterface,
  HookStream,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Timer,
} from "claude-code";
import { download, type Helper, HELPER_WAIT_MS, locate, megabytes, openPage } from "./helper.ts";
import {
  afterExit,
  type Line,
  LineSplitter,
  openWords,
  personWords,
  readLine,
  restartDelay,
  type Shared,
  warningWords,
  whoComesIn,
} from "./local-site.ts";
import { hand, showStatus } from "./status.ts";

// Sharing a local site from Claude Code: Claude calls `share_local_site` with
// the dev server's port, and the plugin runs `tonen share <port> --json`, the
// Tonen CLI, for the rest of the session (ARCHITECTURE.md, "Local site";
// docs/proposals/local-sites.md, "The plugin"), the one helper.ts finds or
// downloads as the plugin's cli.json names it.
//
// The person is asked in Claude Code before each port and project the
// session hasn't shared yet, and told when it downloads the helper. That is
// consent, not the security boundary: the first share of a local site from a
// computer waits for its member's Confirm on the Tonen's own /confirm page,
// which the CLI asks for and the plugin opens in the browser. Asking per port
// matters because that Confirm is the local site's, not a port's: after it,
// a call Claude was talked into (a mention typed on a site) could share any
// port of this computer without a word to the person.
//
// The CLI's lines (`@tonen/contracts/cli`) drive it: `open` opens the browser
// (a sign-in or a confirm), `ready` gives the address (Claude's answer, and
// the band's line), `viewers` the band's count, a `warning` plain words for
// the band and Claude. When the CLI exits it starts again after a back-off,
// unless Tonen closed the local site for good or it needs the person
// (`afterExit`). The session's end stops it.

/** The plugin's tool that shares a local site. */
export const SHARE = "share_local_site";
/** The plugin's tool that stops sharing. */
export const STOP_SHARING = "stop_sharing";

/** How long a warning or a reconnect stays on the band without a newer line. */
const NOTE_MS = 10 * 60_000;
/** How long a share stays up before its next exit backs off from 2 s again (`restartDelay`). */
const STEADY_MS = 60_000;

// What the band draws of the local sites shared (types/index.d.ts);
// register.tsx reads it under the same name (Claude Code reads a mod's state
// only through an atom made in the file that reads it).
const sharing = atom({ plugin: "tonen", key: "sharing" } as const, []);

type Stream = HookStream<ProcessSpawnChunk, ProcessSpawnResult>;
type Pull = IteratorResult<ProcessSpawnChunk, ProcessSpawnResult>;

/** One local site this session shares, and the `tonen` running for it. */
type Share = Shared & {
  helper: Helper;
  /** The project Claude asked for: undefined for the repository's own. */
  asked: string | undefined;
  /** The project asked for; the one `ready` named once it's up. */
  projectId: string | undefined;
  /** Who can comment on the local site, as the newest `ready` said; undefined until then. */
  access: string | undefined;
  /** What runs now: a sign-in first (`tonen login`), or the share itself. */
  phase: "login" | "share";
  /** Whether the share may still sign in by itself: once, for the share the person asked for. */
  maySignIn: boolean;
  stream: Stream | undefined;
  /** The pull under way: a call that stopped waiting leaves it for the loop that reads on. */
  pending: Promise<Pull> | undefined;
  lines: LineSplitter;
  /** The CLI's last line, `closed` or `error`, which says what follows its exit. */
  last: Line | undefined;
  /** Exits in a row without the local site staying up `STEADY_MS`, for the back-off. */
  failures: number;
  /** When this run's `ready` came, on the session's clock; undefined until then. */
  upSince: number | undefined;
  restart: Timer | undefined;
  clearNote: Timer | undefined;
  /** The browser page the CLI asked for last, for Claude to give if the browser didn't open. */
  opened: string | undefined;
  /** The newest warning, in plain words, for Claude: while it's the band's note, no longer. */
  warning: string | undefined;
  /** Claude stopped waiting before it came up: hand it the address in a message then. */
  announce: boolean;
  /** Stopped by Claude, a newer share or the session's end. */
  stopped: boolean;
};

const shares: Share[] = [];
// What the person said yes to in this session (`agreement`): asked again for
// anything else, and in the next session.
const agreed = new Set<string>();
// Ports a call is getting ready to share (asking, downloading), so a second
// call at the same time doesn't start a second `tonen share`.
const starting = new Set<number>();
// Ports whose words the status line shows, a share's that ended among them.
const said = new Set<number>();
// A line the plugin can't read is logged once, not every time.
let badLineLogged = false;

/** Registers `share_local_site` and `stop_sharing`, and clears what a reload left on the band. */
export async function registerSharing($: EngineInterface) {
  await update($, sharing, () => []);
  await $.tool.register({
    name: SHARE,
    description:
      "Shares a dev server on this computer (localhost) as the Tonen project's local site, so the people its setting on its page in Tonen lets in open it from anywhere and comment on it. Asks your member first, downloads Tonen's helper (the Tonen CLI) the first time, and may open their browser to sign in or confirm. Answers with the local site's address. It runs for the rest of this session.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "integer",
          minimum: 1,
          maximum: 65535,
          description: "The dev server's port.",
        },
        projectId: {
          type: "string",
          description:
            "The Tonen project (proj_…); left out, the one this repository's script tag names.",
        },
      },
      required: ["port"],
    },
  });
  await $.tool.register({
    name: STOP_SHARING,
    description:
      "Stops sharing a local site that share_local_site shares in this session: the one on `port`, or every one without it.",
    inputSchema: {
      type: "object",
      properties: { port: { type: "integer", minimum: 1, maximum: 65535 } },
    },
  });
}

/**
 * `share_local_site`: shares `port` (for `projectId`, or the repository's
 * project), and answers Claude in words: the address once it's up, or why
 * not. Stopped when `signal` aborts (the person interrupted the call) before
 * it came up.
 */
export async function shareLocalSite(
  $: EngineInterface,
  port: number,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<string> {
  // A new ask takes down what shares that ended said; a live share's words
  // (a confirm waiting in the browser) stay.
  for (const was of said) if (!shares.some((share) => share.port === was)) say($, was, undefined);
  // A share started without a project knows its project only once it's up:
  // until then it is taken for the one asked, or a second `tonen share` on
  // the port would start and the relay close one of them as replaced.
  const same = shares.find(
    (share) =>
      share.port === port &&
      (projectId === undefined || share.projectId === undefined || share.projectId === projectId),
  );
  if (same?.address) return `localhost:${port} is shared already, as ${same.address}.`;
  if (same) {
    // The call that started it may have answered already (it waits in the
    // browser, or starts again later): the address comes in a message.
    same.announce = true;
    return `localhost:${port} is being shared already; the plugin tells you its address in a message once it's up, or says why not.`;
  }
  if (starting.has(port)) {
    return `localhost:${port} is being shared already: the call that started it answers with its address, or says why not.`;
  }
  starting.add(port);
  let helper: Helper | string;
  try {
    helper = await prepare($, port, projectId, signal);
  } finally {
    starting.delete(port);
  }
  if (typeof helper === "string") return helper;
  // From here to `shares.push` nothing awaits, so no other call slips in.

  // One local site per project: sharing it from another port takes its place.
  // Claude hears which, or it guesses both still run behind the one address.
  // Without a project, it is the repository's, which a share started the same
  // way also shares (a share on this port was taken as `same` above).
  const replaced = shares.filter((s) =>
    projectId === undefined ? s.asked === undefined : s.projectId === projectId,
  );
  for (const other of replaced) stop($, other);
  const instead =
    replaced.length > 0
      ? ` It takes the place of localhost:${replaced.map((s) => s.port).join(" and localhost:")}, which is no longer shared.`
      : "";

  const share: Share = {
    port,
    address: null,
    viewers: 0,
    note: null,
    helper,
    asked: projectId,
    projectId,
    access: undefined,
    phase: "share",
    maySignIn: true,
    stream: undefined,
    pending: undefined,
    lines: new LineSplitter(),
    last: undefined,
    failures: 0,
    upSince: undefined,
    restart: undefined,
    clearNote: undefined,
    opened: undefined,
    warning: undefined,
    announce: false,
    stopped: false,
  };
  shares.push(share);
  // Interrupted while it comes up: stopped. Once Claude has its answer, the
  // share is the session's, whatever happens to the call.
  const interrupted = () => stop($, share);
  signal.addEventListener("abort", interrupted, { once: true });

  // Ends Claude's wait without stopping the share: a pull still under way
  // stays the share's, for the loop that reads on.
  let timedOut: (value: "timeout") => void = () => undefined;
  const timeout = new Promise<"timeout">((resolve) => (timedOut = resolve));
  const timer = $.clock.after(HELPER_WAIT_MS, () => timedOut("timeout"));
  let outcome: Awaited<ReturnType<typeof drive>>;
  try {
    await publish($);
    start($, share);
    outcome = await drive($, share, timeout);
  } catch (error) {
    stop($, share);
    throw error;
  } finally {
    timer.cancel();
    signal.removeEventListener("abort", interrupted);
  }
  switch (outcome) {
    case "ready":
      readOn($, share);
      return `Sharing localhost:${port} as ${share.address}: ${whoComesIn(share.access ?? "")}. It runs while this session does; call ${STOP_SHARING} when your member asks to stop.${instead}${warned(share)}`;
    case "timeout":
      share.announce = true;
      readOn($, share);
      return `Tonen's helper waits for your member in the browser (${share.opened ? `${share.opened}, if it didn't open` : "a sign-in or a confirm"}). Tell them; the plugin hands you the local site's address in a message once it's up, or says why not.${warned(share)}`;
    case "later":
      return `tonen share stopped before localhost:${port} came up (${share.note ?? "no reason given"}). The plugin starts it again by itself and shows it above the prompt.`;
    case "ended":
      return `localhost:${port} isn't shared: ${share.note ?? "tonen share stopped"}.`;
    case "stopped":
      return `Stopped sharing localhost:${port} before it came up.`;
  }
}

/**
 * What comes before a share runs: the helper found, the person's yes for
 * this port and project, the helper downloaded when it isn't here yet. The
 * helper, or Claude's answer in words when it stops there.
 */
async function prepare(
  $: EngineInterface,
  port: number,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<Helper | string> {
  const stopped = `Stopped sharing localhost:${port} before it came up.`;
  const found = await locate($);
  if ("error" in found) return found.error;
  const agreement = `${projectId ?? "this repository's project"}:${port}`;
  if (!agreed.has(agreement)) {
    const yes = "Share it";
    const download = found.download
      ? `First, Claude Code downloads Tonen's helper (the Tonen CLI, ${megabytes(found.download.size)} MB from ${new URL(found.helper.server).host}) into ~/.tonen/bin. `
      : "";
    const project = projectId ? `Tonen project ${projectId}'s` : "your Tonen project's";
    const answer = await $.ui
      .ask(
        `${download}Share localhost:${port} as ${project} local site, for the rest of this session? Who gets in is its setting on its page in Tonen.`,
        { options: [yes, "Don't share"], header: "Tonen" },
      )
      .catch(() => undefined);
    if (signal.aborted) return stopped;
    if (answer !== yes) {
      return `Your member chose not to share localhost:${port}. Don't share it again unless they ask.`;
    }
    agreed.add(agreement);
  }
  // A listener added to a signal that already aborted never runs: the person
  // who pressed Esc during the download would get a share nobody waits for.
  if (signal.aborted) return stopped;
  if (found.download) {
    const failed = await download($, found.helper, found.download);
    if (failed) return failed;
    if (signal.aborted) return stopped;
  }
  return found.helper;
}

/** `stop_sharing`: stops the share of `port`, or every one; Claude's answer in words. */
export function stopSharing($: EngineInterface, port: number | undefined): string {
  const stopping = shares.filter((share) => port === undefined || share.port === port);
  // What a share that ended said goes too (`stop` takes a live one's down):
  // Claude was asked to stop.
  for (const was of said) if (port === undefined || was === port) say($, was, undefined);
  if (stopping.length === 0) {
    return port === undefined
      ? "Nothing is shared in this session."
      : `localhost:${port} isn't shared in this session.`;
  }
  for (const share of stopping) stop($, share);
  return `Stopped sharing ${stopping.map((share) => `localhost:${share.port}`).join(" and ")}. Its address shows "This local site is offline" until it's shared again.`;
}

/** Stops every share: the session ends. */
export function stopAll($: EngineInterface) {
  for (const share of [...shares]) stop($, share);
}

/** What Claude is told each turn while something is shared, or undefined; no counts, so it seldom changes. */
export function sharingSection(): string | undefined {
  if (shares.length === 0) return undefined;
  const each = shares.map((share) => {
    const where =
      share.address === null
        ? `localhost:${share.port} (starting)`
        : `localhost:${share.port} as ${share.address}`;
    return share.warning ? `${where}, which warns: ${share.warning}` : where;
  });
  return `Tonen's plugin shares ${each.join("; ")} for your member's Tonen project in this session (share_local_site). Don't run tonen share yourself; call ${STOP_SHARING} when your member asks to stop.`;
}

// Runs what the share's phase needs: `tonen login` first, or `tonen share`.
function start($: EngineInterface, share: Share) {
  const { path, server } = share.helper;
  const argv =
    share.phase === "login"
      ? [path, "login", "--json", "--server", server]
      : [
          path,
          "share",
          String(share.port),
          "--json",
          "--server",
          server,
          ...(share.projectId ? ["--project", share.projectId] : []),
        ];
  share.stream = $.process.spawn({ argv });
  share.pending = undefined;
  share.lines = new LineSplitter();
  share.last = undefined;
  share.upSince = undefined;
}

/**
 * Reads the share's `tonen` until it's up (`ready`, while Claude waits),
 * Claude stops waiting (`timeout`), it's stopped, or it ends: then a sign-in
 * runs first, it's started again later (`later`), or it's over (`ended`),
 * its words in `note`. Without `timeout`, it reads until one of the last.
 */
async function drive(
  $: EngineInterface,
  share: Share,
  timeout?: Promise<"timeout">,
): Promise<"ready" | "timeout" | "later" | "ended" | "stopped"> {
  for (;;) {
    const read = await readUntil($, share, timeout);
    if (read !== "exited") return read;
    if (share.stopped) return "stopped";
    if (share.phase === "login") {
      if (share.last?.type === "result") {
        share.phase = "share";
        start($, share);
        continue;
      }
      await end(
        $,
        share,
        share.last?.type === "error"
          ? personWords(share.last.code, share.last.message)
          : "Tonen's sign-in didn't finish",
      );
      return "ended";
    }
    const next = afterExit(share.last, share.port);
    if (next.kind === "sign_in" && share.maySignIn) {
      // The share the person asked for signs in on its own, once; one that
      // started again by itself never opens a browser they didn't ask for.
      share.maySignIn = false;
      share.phase = "login";
      start($, share);
      continue;
    }
    if (next.kind === "again") {
      // Only a share that stayed up a while starts the back-off over: one
      // the relay closes right after `ready` would otherwise start again
      // every 2 s, for good.
      const steady =
        share.upSince !== undefined && (await $.clock.now()) - share.upSince >= STEADY_MS;
      share.failures = steady ? 1 : share.failures + 1;
      const ms = restartDelay(share.failures);
      await note($, share, `${next.why}, starting again in ${Math.round(ms / 1000)} s`, undefined);
      share.restart = $.clock.after(ms, () => {
        share.restart = undefined;
        if (share.stopped) return;
        background($, share, startAgain($, share));
      });
      return "later";
    }
    await end(
      $,
      share,
      next.kind === "done"
        ? next.why
        : "Tonen's sign-in on this computer ended: ask Claude to share again to sign in",
    );
    return "ended";
  }
}

// Reads on in the background once Claude has its answer.
function readOn($: EngineInterface, share: Share) {
  $.clock.after(0, () => background($, share, drive($, share)));
}

// Starts the share's `tonen share` again after a back-off and reads it. Its
// helper may be gone: another Tonen's plugin (tonen.app's and development's,
// or an older version) removes the ones it didn't download (`prune`), so it
// is found and downloaded again first.
async function startAgain($: EngineInterface, share: Share) {
  if (!(await $.fs.exists(share.helper.path))) {
    const found = await locate($);
    const failed =
      "error" in found
        ? found.error
        : found.download
          ? await download($, found.helper, found.download)
          : undefined;
    if (share.stopped) return;
    if (failed !== undefined || "error" in found) {
      $.ui.log(`Tonen's helper: ${failed ?? "not found"}`, { to: "debug" });
      await end($, share, "Tonen's helper went missing and couldn't be downloaded again");
      return;
    }
    share.helper = found.helper;
  }
  if (share.stopped) return;
  start($, share);
  await drive($, share);
}

// Work on a share nobody awaits: should it fail (the session refused an
// update, say), the share stops and says so, instead of staying on the band
// with nothing reading its `tonen`.
function background($: EngineInterface, share: Share, work: Promise<unknown>) {
  work.catch((error: unknown) => {
    $.ui.log(`Tonen's plugin stopped reading tonen share: ${String(error)}`, { to: "debug" });
    if (share.stopped) return;
    stop($, share);
    say($, share.port, `stopped sharing localhost:${share.port}: ask Claude to share it again`);
  });
}

async function readUntil(
  $: EngineInterface,
  share: Share,
  timeout: Promise<"timeout"> | undefined,
): Promise<"ready" | "timeout" | "exited" | "stopped"> {
  for (;;) {
    if (share.stopped) return "stopped";
    if (timeout && share.phase === "share" && share.address !== null) return "ready";
    let pulled: Pull | "timeout";
    try {
      pulled = timeout ? await Promise.race([pull(share), timeout]) : await pull(share);
    } catch (error) {
      // It didn't start (no such file, not executable): no use trying again.
      share.last = {
        type: "error",
        code: "start",
        message: `Tonen's helper didn't start (${String(error)})`,
      };
      return "exited";
    }
    if (pulled === "timeout") return "timeout";
    if (pulled.done) {
      for (const line of share.lines.end()) await take($, share, line);
      return "exited";
    }
    // With --json the CLI prints nothing on stderr: whatever does is a crash's.
    if (pulled.value.stream === "stderr") {
      $.ui.log(`tonen: ${pulled.value.text.slice(0, 500)}`, { to: "debug" });
      continue;
    }
    for (const line of share.lines.push(pulled.value.text)) await take($, share, line);
  }
}

// The next piece of the running `tonen`'s output; one pull at a time, kept
// on the share so a reader that stopped waiting leaves it to the next.
function pull(share: Share): Promise<Pull> {
  const stream = share.stream;
  if (!stream) return Promise.resolve({ done: true, value: { code: null, signal: null } });
  if (!share.pending) {
    share.pending = stream.next().finally(() => {
      if (share.stream === stream) share.pending = undefined;
    });
  }
  return share.pending;
}

// One line of the CLI's, acted on.
async function take($: EngineInterface, share: Share, text: string) {
  const line = readLine(text);
  if (line === undefined) {
    if (!badLineLogged) {
      badLineLogged = true;
      $.ui.log(`Tonen's helper printed a line the plugin can't read: ${text.slice(0, 200)}`, {
        to: "debug",
      });
    }
    return;
  }
  switch (line.type) {
    case "open":
      await openBrowser($, share, line.url, openWords(line.why, share.port));
      return;
    case "ready": {
      const first = share.address === null;
      share.address = line.address;
      share.projectId = line.projectId;
      share.access = line.access;
      share.upSince ??= await $.clock.now();
      share.opened = undefined;
      say($, share.port, undefined);
      // Up again: a restart's or a reconnect's words are over. A warning
      // stays, since the CLI sends one (nothing on the port, say) before
      // `ready`; its own timer takes it down.
      if (share.note !== null && share.note === share.warning) await publish($);
      else await note($, share, null, undefined);
      if (first && share.announce) {
        share.announce = false;
        await hand(
          $,
          `Tonen's plugin: localhost:${share.port} is shared now, as ${line.address}. Tell your member: ${whoComesIn(line.access)}.`,
        );
      }
      return;
    }
    case "viewers":
      share.viewers = line.n;
      await publish($);
      return;
    case "warning": {
      const words = warningWords(line, share.port);
      share.warning = words;
      await note($, share, words, NOTE_MS);
      return;
    }
    case "reconnecting":
      await note($, share, "reconnecting", line.inMs + 30_000);
      return;
    case "closed":
    case "error":
    case "result":
      share.last = line;
      return;
    case "unknown":
      return;
  }
}

// Opens a page of this Tonen's (its sign-in or a /confirm page) in the
// browser, and says in the status line what the person does there.
async function openBrowser($: EngineInterface, share: Share, url: string, words: string) {
  const opened = await openPage($, share.helper, url);
  if (opened === undefined) return;
  share.opened = url;
  say($, share.port, opened ? words : `${words}: ${url}`);
}

// Sets what's wrong now on the share's band line (null: nothing), for `ms`
// at most when given.
async function note(
  $: EngineInterface,
  share: Share,
  words: string | null,
  ms: number | undefined,
) {
  share.clearNote?.cancel();
  share.clearNote = undefined;
  // A warning is Claude's while the band shows it: its timer, a restart or a
  // reconnect taking its place ends it (the CLI says it again if it still
  // holds), so Claude isn't told every turn about a dev server long back up.
  if (share.note === share.warning && words !== share.warning) share.warning = undefined;
  share.note = words;
  if (words !== null && ms !== undefined) {
    share.clearNote = $.clock.after(ms, () => {
      share.clearNote = undefined;
      if (share.note === words) void note($, share, null, undefined);
    });
  }
  await publish($);
}

// The share is over for good: off the band, and its words in the status
// line, which needs the person (they ask Claude again, or sign in). Claude,
// told it would hear once the share is up, hears that it won't be.
async function end($: EngineInterface, share: Share, why: string) {
  share.note = why;
  remove(share);
  await publish($);
  say($, share.port, why);
  if (share.announce) {
    share.announce = false;
    await hand(
      $,
      `Tonen's plugin: localhost:${share.port} isn't shared: ${why}. Tell your member.`,
    );
  }
}

// The status line's words for `port`'s share, or none.
function say($: EngineInterface, port: number, words: string | undefined) {
  if (words === undefined) said.delete(port);
  else said.add(port);
  showStatus($, `share:${port}`, words);
}

// Stops the share's `tonen` (ending its stream kills it), its timers and its
// words in the status line (a confirm it waited for, say).
function stop($: EngineInterface, share: Share) {
  share.stopped = true;
  share.restart?.cancel();
  share.clearNote?.cancel();
  const stream = share.stream;
  share.stream = undefined;
  void stream?.return({ code: null, signal: null }).catch(() => undefined);
  remove(share);
  say($, share.port, undefined);
  void publish($);
}

function remove(share: Share) {
  const at = shares.indexOf(share);
  if (at >= 0) shares.splice(at, 1);
}

async function publish($: EngineInterface) {
  const rows: Shared[] = shares.map(({ port, address, viewers, note }) => ({
    port,
    address,
    viewers,
    note,
  }));
  await update($, sharing, () => rows);
}

/** The warnings so far, for Claude's answer. */
const warned = (share: Share) => (share.warning ? ` Tonen warns: ${share.warning}.` : "");
