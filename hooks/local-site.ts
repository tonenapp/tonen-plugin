// What the plugin reads and decides about sharing a local site, kept apart
// from the engine so it is linted and tested with the rest: the lines `tonen
// share --json` prints, what to do when it exits, the Tonen CLI's cli.json,
// this computer's platform, and the words the band and Claude get.
//
// The lines are `@tonen/contracts/cli`'s (`cliLineSchema`). The plugin isn't a
// workspace package and its mod runs without node_modules, so it reads them
// by hand here; apps/web's `claude-plugin-cli.spec.ts` runs every fixture of
// that contract through `readLine` and holds the lists below to the
// contract's, so the two can't drift apart.

/** Why `tonen share` stopped for good: `CLI_CLOSED_REASONS`, which the spec holds this to. */
export const CLOSED_REASONS = [
  "stopped",
  "local_sites_off",
  "local_site_disabled",
  "member_disabled",
  "login_disabled",
  "login_gone",
  "not_on_project",
  "replaced",
  "other",
] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/**
 * The CLI's errors that are worth starting `tonen share` again for, after a
 * while: Tonen or the network didn't answer, or answered something it
 * couldn't read. Every other code needs the person (a sign-in, a confirm, a
 * project) and ends the share, saying why.
 */
export const PASSING_ERRORS = [
  "network",
  "unavailable",
  "server_error",
  "rate_limited",
  "bad_answer",
  "io",
] as const;

/**
 * The CLI's errors that need the person: a sign-in first (`not_signed_in`,
 * `signed_out`), else the share ends, saying why (`afterExit`). With
 * `PASSING_ERRORS`, every one of `CLI_ERROR_CODES` (apps/web's
 * `claude-plugin-cli.spec.ts` checks), so a new code is decided here before
 * it ships.
 */
export const FINAL_ERRORS = [
  "not_signed_in",
  "signed_out",
  "sign_in_failed",
  "api_key",
  "no_project",
  "several_projects",
  "not_found",
  "not_allowed",
  "invalid_args",
  "rejected",
  "conflict",
  "locked",
  "declined",
  "expired",
  "confirm_failed",
  "upgrade_required",
  // Only `tonen upgrade` ends with it, which the plugin never runs: it keeps
  // its own tonen-<version> by cli.json.
  "installed_elsewhere",
] as const;

/** The platforms the CLI is built for, as its download's path names them: `CLI_PLATFORMS`. */
export const PLATFORMS = ["darwin-arm64", "darwin-x86_64", "linux-x86_64", "linux-arm64"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A warning the relay sent about the local site, as the CLI passes it on. */
export type Warning =
  | { type: "warning"; kind: "csp"; sources: string[] }
  | { type: "warning"; kind: "other_project"; projectId: string }
  | { type: "warning"; kind: "dev_server_down" };

/**
 * A line of `tonen share --json` or `tonen login --json`, as far as the
 * plugin reads it (field names as the contract's). `unknown` is a line of a
 * type, a warning of a kind, or a closed reason from a newer CLI: skipped,
 * as the contract asks of every reader.
 */
export type Line =
  | { type: "open"; url: string; why: "sign_in" | "confirm" }
  | { type: "ready"; address: string; port: number; projectId: string; access: string }
  | { type: "viewers"; n: number }
  | Warning
  | { type: "reconnecting"; inMs: number; reason: string }
  | { type: "closed"; reason: ClosedReason }
  | { type: "error"; code: string; message: string }
  | { type: "result"; command: string }
  | { type: "unknown" };

type Json = { [key: string]: unknown };
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  list.find((item) => item === value);

/**
 * One line the CLI printed, read: undefined when it isn't a line of the
 * contract (not JSON, or a known type without its fields), which the plugin
 * logs once and skips.
 */
export function readLine(text: string): Line | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(json) || typeof json.type !== "string") return undefined;
  switch (json.type) {
    case "open": {
      const why = oneOf(["sign_in", "confirm"] as const, json.why);
      return typeof json.url === "string" && why ? { type: "open", url: json.url, why } : undefined;
    }
    case "ready":
      // `access` as the CLI names it: a level from a newer Tonen is still
      // a line to read, and `whoComesIn` words it as one it doesn't know.
      return typeof json.address === "string" &&
        isCount(json.port) &&
        typeof json.projectId === "string" &&
        typeof json.access === "string"
        ? {
            type: "ready",
            address: json.address,
            port: json.port,
            projectId: json.projectId,
            access: json.access,
          }
        : undefined;
    case "viewers":
      return isCount(json.n) ? { type: "viewers", n: json.n } : undefined;
    case "warning":
      switch (json.kind) {
        case "csp":
          return isStrings(json.sources)
            ? { type: "warning", kind: "csp", sources: json.sources }
            : undefined;
        case "other_project":
          return typeof json.projectId === "string"
            ? { type: "warning", kind: "other_project", projectId: json.projectId }
            : undefined;
        case "dev_server_down":
          return { type: "warning", kind: "dev_server_down" };
        default:
          return typeof json.kind === "string" ? { type: "unknown" } : undefined;
      }
    case "reconnecting":
      return isCount(json.inMs) && typeof json.reason === "string"
        ? { type: "reconnecting", inMs: json.inMs, reason: json.reason }
        : undefined;
    case "closed": {
      if (typeof json.reason !== "string") return undefined;
      // A reason from a newer CLI is still the end: as `other`.
      return { type: "closed", reason: oneOf(CLOSED_REASONS, json.reason) ?? "other" };
    }
    case "error":
      return typeof json.code === "string" && typeof json.message === "string"
        ? { type: "error", code: json.code, message: json.message }
        : undefined;
    case "result":
      return typeof json.command === "string"
        ? { type: "result", command: json.command }
        : undefined;
    default:
      return { type: "unknown" };
  }
}

/**
 * Splits what a child writes into whole lines: a piece of output ends
 * wherever the child's write did, so a line may come in two pieces.
 */
export class LineSplitter {
  #rest = "";

  /** The whole lines `text` completes, without their newline; blank ones left out. */
  push(text: string): string[] {
    const parts = (this.#rest + text).split("\n");
    this.#rest = parts.pop() ?? "";
    return parts.map((line) => line.trim()).filter(Boolean);
  }

  /** What's left once the child closed its output: a last line without a newline. */
  end(): string[] {
    const rest = this.#rest.trim();
    this.#rest = "";
    return rest ? [rest] : [];
  }
}

/**
 * What to do once `tonen share` exited, from its last line (`closed` or
 * `error`, or none when it crashed or was killed) and its exit code:
 * start it again after a while (`again`), sign in first (`sign_in`), or
 * stop for good, with the words that say why (`done`).
 */
export type AfterExit =
  | { kind: "again"; why: string }
  | { kind: "sign_in" }
  | { kind: "done"; why: string };

// When the helper is too old for its Tonen (`upgrade_required`), or can't
// read what its Tonen answered (`bad_answer`), the CLI's own words say
// `tonen upgrade`. That updates the person's terminal tonen
// (~/.tonen/bin/tonen) and never the helper, which is the version the
// plugin's cli.json names: the plugin is what's old.

/** What Claude hears then: how to update the plugin. */
export const PLUGIN_TOO_OLD =
  "Tonen's plugin carries an older Tonen CLI than its Tonen takes now: update the plugin (`claude plugin update tonen@tonen`, which you may run for your member), then they restart Claude Code. Their own terminal's tonen, if they use one, updates with `tonen upgrade`";

/**
 * Whether a download of the helper failed because its Tonen no longer serves
 * that version: curl's and wget's words for a 404 (curl's exit for it differs
 * between versions, 22 or 56). Web serves only its current release, so the
 * plugin is what's old.
 */
export function goneFromServer(exitCode: number, stderr: string): boolean {
  return exitCode !== 0 && /(returned error: |ERROR )404\b/.test(stderr);
}

/** The helper's `error` words for Claude (`tonen_cli`'s answer): its own, but when the plugin is what's old. */
export function helperWords(code: string, message: string): string {
  if (code === "upgrade_required") return `${PLUGIN_TOO_OLD}.`;
  if (code === "bad_answer")
    return `${message} The plugin may be older than its Tonen: ${PLUGIN_TOO_OLD}.`;
  return message;
}

/** The same for the person, in the status line: no command to run. */
export function personWords(code: string, message: string): string {
  if (code === "upgrade_required") {
    return "Tonen's plugin is older than Tonen now: ask Claude to update it, then restart Claude Code";
  }
  if (code === "bad_answer") {
    return "Tonen answered in a way Tonen's plugin can't read: ask Claude to update the plugin, then restart Claude Code";
  }
  return message;
}

export function afterExit(last: Line | undefined, port: number): AfterExit {
  if (last?.type === "closed") {
    switch (last.reason) {
      case "stopped":
        return { kind: "done", why: `stopped sharing localhost:${port}` };
      case "replaced":
        return {
          kind: "done",
          why: `localhost:${port} stopped: another tonen share of yours took this project's local site over`,
        };
      case "local_site_disabled":
        return { kind: "done", why: "Tonen turned this local site off" };
      case "local_sites_off":
        return { kind: "done", why: "Tonen turned local sites off for now" };
      case "member_disabled":
        return { kind: "done", why: "Tonen turned local sites off for your account" };
      case "login_disabled":
        return { kind: "done", why: "Tonen turned local sites off for this computer's sign-in" };
      case "login_gone":
        return {
          kind: "done",
          why: "Tonen's sign-in on this computer ended: ask Claude to share again to sign in",
        };
      case "not_on_project":
        return { kind: "done", why: "you're no longer on this project" };
      case "other":
        return { kind: "again", why: "Tonen closed the local site" };
    }
  }
  if (last?.type === "error") {
    if (oneOf(PASSING_ERRORS, last.code)) {
      return { kind: "again", why: personWords(last.code, last.message) };
    }
    const code = oneOf(FINAL_ERRORS, last.code);
    if (code === "not_signed_in" || code === "signed_out") return { kind: "sign_in" };
    // The CLI's own words say to run it with --take-over, which the plugin
    // doesn't: Claude would run a `tonen` that isn't on the PATH.
    if (code === "conflict") {
      return {
        kind: "done",
        why: `another computer of yours shares this project's local site now: stop it there, then ask Claude to share localhost:${port} again`,
      };
    }
    // Every other final code ends the share in the CLI's own words (but a
    // plugin that's too old, `personWords`), and so
    // does a code that isn't the CLI's: the plugin's own `start` (the helper
    // didn't run, and won't the next time either), or one from a newer CLI,
    // which ends the share rather than start it again for good.
    return { kind: "done", why: personWords(last.code, last.message) };
  }
  // No last line: it crashed or something killed it. Try again.
  return { kind: "again", why: "tonen share stopped" };
}

/**
 * How long to wait before starting `tonen share` again after `failures`
 * exits in a row: 2 s, doubling, at most two minutes. A share that stayed
 * up a minute (`STEADY_MS` in share.ts) starts the count over; one that comes
 * up and drops at once keeps backing off.
 */
export const restartDelay = (failures: number) =>
  Math.min(120_000, 2_000 * 2 ** Math.max(0, failures - 1));

/** cli.json: the CLI's version web serves, and each platform's binary's sha256 and size. */
export type Manifest = {
  version: string;
  platforms: Partial<Record<Platform, { sha256: string; size: number }>>;
};

/**
 * cli.json read as `cliManifestSchema` checks it: undefined for anything
 * else. Its version names a file (`tonen-<version>`) and a path, so it is
 * held to the same characters.
 */
export function readManifest(json: unknown): Manifest | undefined {
  if (!isObject(json) || typeof json.version !== "string") return undefined;
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(json.version)) return undefined;
  if (!isObject(json.platforms)) return undefined;
  const platforms: Manifest["platforms"] = {};
  for (const [name, entry] of Object.entries(json.platforms)) {
    const platform = oneOf(PLATFORMS, name);
    if (!platform || !isObject(entry)) return undefined;
    const { sha256, size } = entry;
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
    if (!isCount(size) || size === 0) return undefined;
    platforms[platform] = { sha256, size };
  }
  return { version: json.version, platforms };
}

/**
 * This computer's platform as the CLI's downloads name it, from `uname -s`,
 * `uname -m`, and whether a Mac runs this process under Rosetta (then the
 * native arm64 binary, as install.sh picks). Undefined for one the CLI isn't
 * built for. Windows comes later: there `uname` doesn't run, and the helper
 * would go in `%LOCALAPPDATA%\Tonen\bin` as `tonen.exe`.
 */
export function platformOf(os: string, arch: string, rosetta: boolean): Platform | undefined {
  const system = new Map([
    ["Darwin", "darwin"],
    ["Linux", "linux"],
  ]).get(os.trim());
  const machine = new Map([
    ["arm64", "arm64"],
    ["aarch64", "arm64"],
    ["x86_64", "x86_64"],
    ["amd64", "x86_64"],
  ]).get(arch.trim());
  if (!system || !machine) return undefined;
  const native = system === "darwin" && machine === "x86_64" && rosetta ? "arm64" : machine;
  return oneOf(PLATFORMS, `${system}-${native}`);
}

/**
 * The Tonen this plugin talks to, from its .mcp.json (web writes its own
 * /mcp there, so a preview or a worktree's plugin has its own): the origin
 * `tonen --server` takes. Undefined when there's none, or it's plain http
 * to another computer, which the CLI refuses too (`Server::parse`): the
 * plugin finds that out before it downloads anything.
 */
export function serverOf(mcpJson: unknown): string | undefined {
  if (!isObject(mcpJson) || !isObject(mcpJson.mcpServers)) return undefined;
  const tonen = mcpJson.mcpServers.tonen;
  if (!isObject(tonen) || typeof tonen.url !== "string") return undefined;
  try {
    const url = new URL(tonen.url);
    if (url.protocol === "https:") return url.origin;
    return url.protocol === "http:" && isLoopback(url.hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

// This computer, as `@tonen/contracts/loopback` and the CLI's `is_loopback`
// say it: every name under .localhost is (RFC 6761).
const isLoopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(hostname) || hostname.endsWith(".localhost");

/** The hash `sha256sum` or `shasum -a 256` printed for one file, or undefined. */
export function sha256In(output: string): string | undefined {
  const hash = output.trim().split(/\s+/)[0]?.toLowerCase();
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : undefined;
}

/**
 * Whether the browser may go to `url` for the CLI: only a page of the Tonen
 * it signs in to (its sign-in or a /confirm page), over http or https, as the
 * CLI itself checks before it opens one.
 */
export function opensOn(url: string, server: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.origin === server
    );
  } catch {
    return false;
  }
}

/** What a warning says, in plain words, for the band and for Claude. */
export function warningWords(warning: Warning, port: number): string {
  switch (warning.kind) {
    case "csp":
      return `the site's Content-Security-Policy keeps Tonen's bar out: add ${warning.sources.join("; ")}`;
    case "other_project":
      return `the page loads another project's bar (${warning.projectId})`;
    case "dev_server_down":
      return `nothing answers on localhost:${port}: start the dev server`;
  }
}

/** What the person does in the browser for an `open` line: the status line's words. */
export function openWords(why: "sign_in" | "confirm", port: number): string {
  return why === "sign_in"
    ? `sign in to Tonen in your browser to share localhost:${port}`
    : `confirm sharing localhost:${port} in your browser`;
}

/**
 * Who opens a shared local site and comments there, by its level (the
 * `ready` line's `access`), for what Claude tells its member.
 */
export function whoComesIn(access: string): string {
  switch (access) {
    case "anyone":
      return "anyone who opens it reads its comments, and comments after signing in";
    case "link":
      return "the project's members and reviewers, and whoever opens the local site's own share link, which your member makes on the project's Setup tab, open it there and comment (Tonen asks them to sign in)";
    case "people":
      return "the project's members and reviewers open it there and comment (Tonen asks them to sign in)";
    default:
      return "whoever its Setup tab lets in opens it there and comments";
  }
}

/** One local site the plugin shares, as the band shows it. */
export type Shared = {
  port: number;
  /** The local site's address once it's up; null while it starts. */
  address: string | null;
  viewers: number;
  /** What's wrong now, in plain words (a warning, a restart); null when nothing is. */
  note: string | null;
};

/**
 * What Claude asked `share_local_site` for: the dev server's port and the
 * project, or undefined for the one the repository's script tag names. A
 * string says what's wrong with the call.
 */
export function shareArgsOf(
  input: unknown,
): { port: number; projectId: string | undefined } | string {
  const args = isObject(input) ? input : {};
  if (args.port === undefined) return "Give the dev server's port (5173, say).";
  const port = portOf(args.port);
  if (port === undefined) return PORT_RANGE;
  const projectId = args.projectId;
  if (projectId === undefined || projectId === "") return { port, projectId: undefined };
  // The Tonen CLI's rule, as `PROJECT_ID` in listen.ts, which this file can't
  // import (Claude Code's tsconfig, which lint reads where it's written, takes
  // no ".ts" import): claude-plugin-cli.spec.ts holds the copies together.
  if (typeof projectId !== "string" || !/^proj_[0-9A-Za-z_]{3,59}$/.test(projectId)) {
    return "projectId is a Tonen project's id (proj_…), as `projects` lists them.";
  }
  return { port, projectId };
}

/**
 * What Claude asked `stop_sharing` for: a port, or undefined to stop every
 * share. A string says what's wrong with the call.
 */
export function stopArgsOf(input: unknown): { port: number | undefined } | string {
  const args = isObject(input) ? input : {};
  if (args.port === undefined) return { port: undefined };
  const port = portOf(args.port);
  return port === undefined ? PORT_RANGE : { port };
}

const PORT_RANGE = "The port is a whole number from 1 to 65535.";
const portOf = (value: unknown) =>
  isCount(value) && value >= 1 && value <= 65535 ? value : undefined;

/** The band's line for one shared local site: "Sharing localhost:5173 · https://happy-hobbit.tonen.site · 0 viewers". */
export function sharingLine(shared: Shared): string {
  const parts = [`Sharing localhost:${shared.port}`];
  if (shared.address === null) parts.push("starting");
  else {
    parts.push(shared.address);
    parts.push(`${shared.viewers} ${shared.viewers === 1 ? "viewer" : "viewers"}`);
  }
  if (shared.note !== null) parts.push(shared.note);
  return parts.join(" · ");
}
