import type {
  EngineInterface,
  HookStream,
  ProcessSpawnChunk,
  ProcessSpawnResult,
} from "claude-code";
import {
  answerOf,
  argvOf,
  CLI_TOOL,
  CLI_TOOL_SCHEMA,
  type CliCommand,
  commandLine,
  errorOf,
} from "./cli-tool.ts";
import { helperWords, LineSplitter, opensOn, readLine } from "./local-site.ts";
import { download, type Helper, locate, megabytes } from "./share.ts";
import { hand, showStatus } from "./status.ts";

// `tonen_cli`: Claude runs the Tonen CLI for its member's errands (setting a
// site up, its sites, its reviewers, its share link), with `--json`, through
// the plugin rather than a shell: no PATH to find, no permission prompt for
// each call, and the CLI exactly as the plugin's cli.json names it, checked
// as `share_local_site` checks it (share.ts). cli-tool.ts holds what Claude
// may ask and how its answer reads.
//
// The CLI's `open` lines open the browser, on this Tonen only: its sign-in
// (a first call signs this computer in by itself, once) and the /confirm
// page for what only a person may do, which is the security boundary.
// Claude waits up to 100 s; past that the plugin hands it the answer in a
// message once the person is done in the browser.

/** How long Claude's call waits, under Claude Code's two minutes. */
const WAIT_MS = 100_000;

type Stream = HookStream<ProcessSpawnChunk, ProcessSpawnResult>;

/** How one run of the CLI ended: its result line's JSON, or its error. */
type Ran = { kind: "result"; json: unknown } | { kind: "error"; code: string; message: string };

// The person said yes to downloading the helper in this session.
let downloadAgreed = false;

// Each run's own part of the status line, so one run's end doesn't take
// down what another still waits for in the browser.
let runs = 0;
const statusPart = (): `cli:${number}` => `cli:${++runs}`;

/** Registers `tonen_cli`. */
export async function registerCliTool($: EngineInterface) {
  await $.tool.register({
    name: CLI_TOOL,
    description:
      "Runs the Tonen CLI on this computer as your member, for their errands on Tonen: what's set up here (status), their projects, setting this repository's site up (init: a project, the script tag, the CSP sources), adding a site, reading the project's comments, adding reviewers by email and making the share link. Answers with the CLI's result as JSON. Downloads Tonen's helper the first time (asking your member), and may open their browser to sign in or to confirm what only they may do. Fixing comments, replying and marking them stay on Tonen's MCP tools, so people see your work as yours. Its helper comes with the plugin and updates with it (`claude plugin update tonen@tonen`, then a restart of Claude Code); a `tonen` in your member's own terminal updates with `tonen upgrade` (the line its notice or error prints), which you may run for them.",
    inputSchema: CLI_TOOL_SCHEMA,
  });
}

/** `tonen_cli`: runs what Claude asked, and answers in words. */
export async function runCliTool(
  $: EngineInterface,
  input: unknown,
  signal: AbortSignal,
): Promise<string> {
  const asked = argvOf(input);
  if (typeof asked === "string") return asked;
  const found = await locate($);
  if ("error" in found) return found.error;
  if (found.download) {
    if (!downloadAgreed) {
      const yes = "Download it";
      const answer = await $.ui
        .ask(
          `Claude Code downloads Tonen's helper (the Tonen CLI, ${megabytes(found.download.size)} MB from ${new URL(found.helper.server).host}) into ~/.tonen/bin, to work on Tonen for you. Go ahead?`,
          { options: [yes, "Not now"], header: "Tonen" },
        )
        .catch(() => undefined);
      if (answer !== yes) {
        return "Your member chose not to download Tonen's helper. Don't ask again unless they do.";
      }
      downloadAgreed = true;
    }
    if (signal.aborted) return "Stopped before Tonen's helper ran.";
    const failed = await download($, found.helper, found.download);
    if (failed) return failed;
    // Esc during the download: nothing waits for the CLI's answer any more.
    if (signal.aborted) return "Stopped before Tonen's helper ran.";
  }
  // Any command may wait in the browser: the first signs this computer in.
  const work = signedIn($, found.helper, asked.argv, signal);
  let timedOut: (value: "timeout") => void = () => undefined;
  const timeout = new Promise<"timeout">((resolve) => (timedOut = resolve));
  const timer = $.clock.after(WAIT_MS, () => timedOut("timeout"));
  const first = await Promise.race([work, timeout]);
  timer.cancel();
  if (first !== "timeout") return answer(asked.command, first);
  void work.then(
    (ran) =>
      hand(
        $,
        // Comment text is strangers': never handed in as a turn of its own.
        asked.command === "comments" && ran.kind === "result"
          ? "Tonen's plugin: this computer is signed in to Tonen now. Call tonen_cli comments again for the project's comments."
          : `Tonen's plugin, the answer to tonen_cli ${asked.command}: ${answer(asked.command, ran)}`,
      ),
    (error: unknown) => $.ui.log(`tonen_cli: ${String(error)}`, { to: "debug" }),
  );
  return "Tonen waits for your member in the browser (a sign-in or a Confirm). Tell them; the plugin hands you the answer in a message once they're done.";
}

function answer(command: CliCommand, ran: Ran): string {
  return ran.kind === "result"
    ? answerOf(command, ran.json)
    : errorOf(ran.code, helperWords(ran.code, ran.message));
}

// Runs `argv`; when this computer isn't signed in to this Tonen (or its
// sign-in ended), signs it in first, once, and runs it again.
async function signedIn(
  $: EngineInterface,
  helper: Helper,
  argv: string[],
  signal: AbortSignal,
): Promise<Ran> {
  const ran = await runOnce($, helper, argv, signal);
  if (ran.kind !== "error" || !["not_signed_in", "signed_out"].includes(ran.code)) return ran;
  const login = await runOnce($, helper, ["login"], signal);
  if (login.kind === "error") return login;
  return runOnce($, helper, argv, signal);
}

// One run of the CLI, read to its last line, its `open` lines followed.
async function runOnce(
  $: EngineInterface,
  helper: Helper,
  argv: string[],
  signal: AbortSignal,
): Promise<Ran> {
  // A listener added to a signal that already aborted never runs.
  if (signal.aborted) return { kind: "error", code: "stopped", message: "Your member stopped it." };
  const part = statusPart();
  const stream: Stream = $.process.spawn({
    argv: commandLine(helper.path, helper.server, argv),
  });
  const stop = () => void stream.return({ code: null, signal: null }).catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  const lines = new LineSplitter();
  let last: Ran | undefined;
  const take = async (text: string) => {
    const line = readLine(text);
    if (line?.type === "open") {
      await openBrowser($, helper, line.url, line.why, part);
    } else if (line?.type === "error") {
      last = { kind: "error", code: line.code, message: line.message };
    } else if (line?.type === "result") {
      last = { kind: "result", json: JSON.parse(text) };
    }
  };
  try {
    for (;;) {
      const pulled = await stream.next();
      if (pulled.done) break;
      // With --json the CLI prints nothing on stderr: whatever does is a crash's.
      if (pulled.value.stream === "stderr") {
        $.ui.log(`tonen: ${pulled.value.text.slice(0, 500)}`, { to: "debug" });
        continue;
      }
      for (const line of lines.push(pulled.value.text)) await take(line);
    }
    for (const line of lines.end()) await take(line);
  } catch (error) {
    return {
      kind: "error",
      code: "start",
      message: `Tonen's helper didn't start (${String(error)}).`,
    };
  } finally {
    signal.removeEventListener("abort", stop);
    showStatus($, part, undefined);
  }
  if (signal.aborted) return { kind: "error", code: "stopped", message: "Your member stopped it." };
  return (
    last ?? { kind: "error", code: "no_answer", message: "Tonen's helper ended without an answer." }
  );
}

// Opens this Tonen's sign-in or /confirm page, and says in the status line
// what the person does there.
async function openBrowser(
  $: EngineInterface,
  helper: Helper,
  url: string,
  why: "sign_in" | "confirm",
  part: `cli:${number}`,
) {
  if (!opensOn(url, helper.server)) {
    $.ui.log(`Tonen's helper asked to open a page elsewhere than ${helper.server}`, {
      to: "debug",
    });
    return;
  }
  const words =
    why === "sign_in" ? "sign in to Tonen in your browser" : "confirm it on Tonen in your browser";
  const opener = helper.system === "darwin" ? "open" : "xdg-open";
  let opened = false;
  try {
    opened = (await $.process.run([opener, url], { timeoutMs: 10_000 })).exitCode === 0;
  } catch {
    opened = false;
  }
  showStatus($, part, opened ? words : `${words}: ${url}`);
}
