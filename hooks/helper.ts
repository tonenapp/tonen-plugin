import type { EngineInterface } from "claude-code";
import {
  goneFromServer,
  type Manifest,
  opensOn,
  PLUGIN_TOO_OLD,
  type Platform,
  platformOf,
  readManifest,
  serverOf,
  sha256In,
} from "./local-site.ts";

// Tonen's helper, the Tonen CLI, for the plugin's tools that run it
// (`share_local_site` in share.ts, `tonen_cli` in cli.ts): found on this
// computer or downloaded once from the Tonen this plugin came from, exactly
// the binary its cli.json names (version and sha256), into
// ~/.tonen/bin/tonen-<version>-<12 hex of its sha256>; and the pages of that
// Tonen it opens in the browser. The name holds the bytes too: a version names
// one binary on tonen.app, but a preview's later push can serve other bytes
// under the same version.

/**
 * How long Claude's call waits for the helper: a first run waits for the
 * person to sign in or confirm in the browser. Under Claude Code's two
 * minutes, past which a call goes to the background; longer, the plugin
 * hands Claude the answer in a message of its own once it's there.
 */
export const HELPER_WAIT_MS = 100_000;

/** The Tonen CLI on this computer, and the Tonen it talks to. */
export type Helper = { path: string; server: string; system: "darwin" | "linux" };

/**
 * Where the Tonen CLI is or goes, for this plugin's Tonen and this computer:
 * its path, and what to download when it isn't there yet. An error says, in
 * words for Claude, why it can't be.
 */
export async function locate(
  $: EngineInterface,
): Promise<
  | { helper: Helper; download: (Manifest["platforms"][Platform] & { url: string }) | undefined }
  | { error: string }
> {
  const root = $.plugin.root;
  const manifest = readManifest(await readJson($, `${root}/cli.json`));
  const server = serverOf(await readJson($, `${root}/.mcp.json`));
  if (manifest && !server) {
    return {
      error:
        "This copy of Tonen's plugin names no Tonen on https or on this computer (its .mcp.json), and Tonen's helper talks plain http only to this computer. Install the plugin from the member's Tonen over https.",
    };
  }
  if (!manifest || !server) {
    // The terminal's `tonen` goes to tonen.app unless told which Tonen.
    const terminal = server
      ? `\`tonen share <port> --server ${server}\` in their terminal (curl -fsSL ${server}/install.sh | sh installs it)`
      : "`tonen share <port>` in their terminal (curl -fsSL https://tonen.app/install.sh | sh installs it)";
    return {
      error: `This copy of Tonen's plugin carries no Tonen CLI to share with (its cli.json, which Tonen writes into the plugin it serves). Tell your member to run ${terminal}, or install the plugin from their Tonen.`,
    };
  }
  const os = await run($, ["uname", "-s"]);
  const machine = await run($, ["uname", "-m"]);
  // Windows comes later (local-site.ts, `platformOf`): no uname there.
  if (os.exitCode !== 0 || machine.exitCode !== 0) {
    return {
      error:
        "Sharing a local site from Claude Code works on macOS and Linux for now; Windows comes later.",
    };
  }
  const rosetta =
    os.stdout.trim() === "Darwin" && machine.stdout.trim() === "x86_64"
      ? (await run($, ["sysctl", "-n", "sysctl.proc_translated"])).stdout.trim() === "1"
      : false;
  const platform = platformOf(os.stdout, machine.stdout, rosetta);
  const entry = platform ? manifest.platforms[platform] : undefined;
  if (!platform || !entry) {
    return {
      error: `${server} has no Tonen CLI for this computer (${os.stdout.trim()} ${machine.stdout.trim()}), so it can't share a local site from here.`,
    };
  }
  const home = await $.env.get("HOME");
  if (!home) return { error: "HOME isn't set, so there's no ~/.tonen for Tonen's helper." };
  const path = `${home}/.tonen/bin/tonen-${manifest.version}-${entry.sha256.slice(0, 12)}`;
  const helper: Helper = {
    path,
    server,
    system: platform.startsWith("darwin") ? "darwin" : "linux",
  };
  if (await $.fs.exists(path)) return { helper, download: undefined };
  return {
    helper,
    download: { ...entry, url: `${server}/cli/${manifest.version}/${platform}` },
  };
}

/**
 * Downloads the helper beside where it goes, checks its sha256 against
 * cli.json's before anything can run it, makes it executable and moves it
 * into place in one step, as install.sh does: a failed or forged download
 * leaves nothing behind. Undefined when it's in place; else why not, for
 * Claude.
 */
export async function download(
  $: EngineInterface,
  helper: Helper,
  file: { url: string; sha256: string },
): Promise<string | undefined> {
  const bin = helper.path.slice(0, helper.path.lastIndexOf("/"));
  const tonenDir = bin.slice(0, bin.lastIndexOf("/"));
  // ~/.tonen holds the CLI's sign-ins too: only its owner may read it.
  if (!(await $.fs.exists(tonenDir))) await run($, ["mkdir", "-m", "700", tonenDir]);
  if ((await run($, ["mkdir", "-p", bin])).exitCode !== 0) return `Couldn't make ${bin}.`;
  const made = await run($, ["mktemp", `${bin}/.tonen-download.XXXXXX`]);
  const tmp = made.stdout.trim();
  if (made.exitCode !== 0 || !tmp) return `Couldn't write in ${bin}.`;
  try {
    // No shell: each argument as it is. curl, else wget.
    let fetched = await run(
      $,
      ["curl", "-fsSL", "--max-time", "300", "-o", tmp, file.url],
      320_000,
    );
    if (fetched.exitCode === 127)
      fetched = await run($, ["wget", "-q", "-T", "300", "-O", tmp, file.url], 320_000);
    if (goneFromServer(fetched.exitCode, fetched.stderr)) {
      return `${helper.server} no longer serves the Tonen CLI this copy of the plugin names. ${PLUGIN_TOO_OLD}.`;
    }
    if (fetched.exitCode !== 0) {
      return `Downloading Tonen's helper from ${file.url} failed (${firstLine(fetched.stderr) || `exit ${fetched.exitCode}`}). Check the connection and ask again.`;
    }
    let hashed = await run($, ["sha256sum", tmp], 60_000);
    if (hashed.exitCode !== 0) hashed = await run($, ["shasum", "-a", "256", tmp], 60_000);
    const got = sha256In(hashed.stdout);
    if (got === undefined)
      return "Couldn't check the download: this computer has neither sha256sum nor shasum.";
    if (got !== file.sha256) {
      return `The helper downloaded from ${file.url} isn't the file Tonen published (its sha256 is ${got}), so it wasn't kept. Ask again; if it happens again, tell the people who run ${helper.server}.`;
    }
    if ((await run($, ["chmod", "755", tmp])).exitCode !== 0)
      return `Couldn't make ${tmp} executable.`;
    if ((await run($, ["mv", "-f", tmp, helper.path])).exitCode !== 0) {
      return `Couldn't move the helper to ${helper.path}.`;
    }
  } finally {
    await run($, ["rm", "-f", tmp]);
  }
  await prune($, bin, helper.path);
  return undefined;
}

// Removes the helpers of other versions this plugin downloaded before (each
// Tonen release, and in development each rebuild, is a new one): a running
// one keeps its file open, and a share that still needs one downloads it
// again before its next start (`startAgain` in share.ts). install.sh's `tonen` is the
// person's own and stays. So do downloads under way; one a session's end cut
// off (its `finally` never ran) goes once it's an hour old, far past curl's
// five minutes.
async function prune($: EngineInterface, bin: string, keep: string) {
  const entries = await $.fs.list(bin).catch(() => []);
  const old = entries
    .map((entry) => `${bin}/${entry.name}`)
    .filter((path) => path !== keep && /\/tonen-[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(path));
  if (old.length > 0) await run($, ["rm", "-f", "--", ...old]);
  await run($, [
    "find",
    bin,
    "-maxdepth",
    "1",
    "-name",
    ".tonen-download.*",
    "-mmin",
    "+60",
    "-delete",
  ]);
}

/**
 * Opens a page of the helper's Tonen (its sign-in or a /confirm page) in the
 * browser: whether it opened. Undefined for a page elsewhere, which it never
 * opens (`opensOn`).
 */
export async function openPage(
  $: EngineInterface,
  helper: Helper,
  url: string,
): Promise<boolean | undefined> {
  if (!opensOn(url, helper.server)) {
    $.ui.log(`Tonen's helper asked to open a page elsewhere than ${helper.server}`, {
      to: "debug",
    });
    return undefined;
  }
  const opener = helper.system === "darwin" ? "open" : "xdg-open";
  return (await run($, [opener, url], 10_000)).exitCode === 0;
}

/** A download's size in whole megabytes, at least 1, for the person's question. */
export const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1_000_000));

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

/** A file's JSON, or undefined when it's missing or isn't JSON. */
async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    const json: unknown = JSON.parse(await $.fs.read(path));
    return json;
  } catch {
    return undefined;
  }
}

/** `argv` run without a shell; a command that can't start reads as exit 127. */
async function run($: EngineInterface, argv: string[], timeoutMs = 30_000) {
  try {
    return await $.process.run(argv, { timeoutMs });
  } catch (error) {
    return { exitCode: 127, stdout: "", stderr: String(error) };
  }
}
