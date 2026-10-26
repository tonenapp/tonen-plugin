// What the plugin reads and decides, kept apart from the hooks so it has no
// engine in it: the project a repository's pages load Tonen for, the branch it
// has checked out, Tonen's answer to `wait_for_mention` (`via: "plugin"`),
// and how long to wait after a call that failed.

/** How long Tonen holds the plugin's call at most (`PLUGIN_LISTEN_MS` in agent-mcp/mention-tool.ts). */
export const HOLD_MS = 100_000;

/**
 * Whether Claude Code moves the plugin's held call to the background before
 * Tonen ends it: `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` below the hold (Tonen's
 * listen prompt offers it to sessions without the plugin). Each call's end
 * would then start a turn of the model's, every 100 seconds.
 */
export function backgroundsTooSoon(setting: string | undefined): boolean {
  if (setting === undefined || setting.trim() === "") return false;
  const ms = Number(setting);
  return Number.isFinite(ms) && ms < HOLD_MS + 10_000;
}

// A project's id: the Tonen CLI's rule for the tonen.json and script tags it
// reads (`is_project_id` in apps/cli/src/project.rs), and the same in
// `git grep -E` and in JS.
const PROJECT_ID_SHAPE = "proj_[0-9A-Za-z_]{3,59}";

// A whole one; local-site.ts's `shareArgsOf` and cli-tool.ts's `argvOf`
// hold copies.
const PROJECT_ID = new RegExp(`^${PROJECT_ID_SHAPE}$`);

/**
 * The pattern `git grep -E` finds Tonen's script tag by, in every form
 * Tonen's `install` writes it: `data-project="proj_…"` in HTML and JSX,
 * `"data-project": "proj_…"` in a Nuxt config.
 */
export const TAG_PATTERN = `data-project"?[[:space:]]*[:=][[:space:]]*"${PROJECT_ID_SHAPE}"`;

/**
 * The projects this repository's files load Tonen's bar for, each once, in
 * the order `git grep` found them (`TAG_PATTERN`: the script tag the setup
 * prompt adds). Empty in a repository without Tonen, where the plugin stays
 * quiet.
 */
export function projectsIn(grepOutput: string): string[] {
  const found = grepOutput.matchAll(
    new RegExp(`data-project"?\\s*[:=]\\s*"(${PROJECT_ID_SHAPE})"`, "g"),
  );
  const ids = [...found].map((m) => m[1] ?? "");
  return [...new Set(ids.filter(Boolean))];
}

/**
 * The project a repository's `tonen.json` names (`{"project": "proj_…"}`, which
 * `tonen init` and `tonen link` write at its root), or undefined for a
 * missing or unreadable one: it comes first among the candidates, before
 * the script tags `git grep` finds.
 */
export function projectOfConfig(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || !("project" in json)) return undefined;
  const id = json.project;
  return typeof id === "string" && PROJECT_ID.test(id) ? id : undefined;
}

/**
 * The first of `candidates` that is one of the member's projects, as Tonen's
 * `projects` tool lists them, each line starting with its id ("proj_… · Name ·
 * branches: …"). A repository can hold another project's tag (a test fixture,
 * an example): only one of the member's own is listened on.
 */
export function ownProject(
  candidates: readonly string[],
  projectsText: string,
): string | undefined {
  const ids = projectsText.matchAll(new RegExp(`^(${PROJECT_ID_SHAPE}) · `, "gm"));
  const own = new Set([...ids].map((m) => m[1]));
  return candidates.find((id) => own.has(id));
}

/**
 * The branch `git rev-parse --abbrev-ref HEAD` printed, or undefined when
 * there's none to report: a detached HEAD (git prints `HEAD`), or nothing.
 */
export function checkedOutIn(gitOutput: string): string | undefined {
  const name = gitOutput.trim();
  return name === "" || name === "HEAD" ? undefined : name;
}

/** A project's comments as `projects` counts them: open with nobody on it, in progress, fixed. */
export type Counts = { toFix: number; inProgress: number; fixed: number };

/**
 * `projectId`'s counts in the text of Tonen's `projects` tool, whose line for it
 * starts with its id and holds "3 open, 1 in progress, 0 fixed".
 */
export function countsIn(projectsText: string, projectId: string): Counts | undefined {
  const line = projectsText.split("\n").find((l) => l.startsWith(`${projectId} · `));
  const found = line && /(\d+) open, (\d+) in progress, (\d+) fixed/.exec(line);
  if (!found) return undefined;
  return { toFix: Number(found[1]), inProgress: Number(found[2]), fixed: Number(found[3]) };
}

/** The band's line while the plugin listens, with what's left to fix when there is some. */
export function listeningLine(toFix: number): string {
  const listening = "Tonen · listening for @Claude";
  if (toFix === 0) return listening;
  return `${listening} · ${toFix} ${toFix === 1 ? "comment" : "comments"} to fix`;
}

/**
 * The project Claude asked `wait_for_mention` to listen on, from its call's
 * arguments; undefined for all of the member's projects.
 */
export function projectIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("projectId" in input)) return undefined;
  return typeof input.projectId === "string" && input.projectId !== ""
    ? input.projectId
    : undefined;
}

/**
 * Whether a repository's tracked files (`git ls-files`, one per line) look
 * like a website's: a page or a component a browser shows. Where Tonen isn't
 * set up, only such a repository gets the hint about /tonen:setup.
 */
export function looksLikeSite(paths: string): boolean {
  return /\.(html|svelte|vue|jsx|tsx|astro|erb|php|hbs|njk|liquid)$/m.test(paths);
}

/**
 * Tonen's answer to a `wait_for_mention` the plugin made, as the server's
 * `PluginAnswer` (apps/web/src/lib/server/agent-mcp/mention-tool.ts) sends it: a
 * mention, with the prompt to hand the session, or why the call ended. A
 * failed call is `failed`, with what Tonen said; anything else, from a newer
 * Tonen, is `waiting`, so the plugin calls again.
 */
export type Answer =
  | { kind: "mention"; projectId: string; commentId: string; prompt: string; notice: string }
  | { kind: "waiting" | "restarting" | "replaced" | "stopped" }
  | { kind: "refused"; message: string }
  | { kind: "failed" };

type CallResult = { content: readonly { type: string; text?: string }[]; isError: boolean };

/** Tonen's answer to the plugin's `wait_for_mention`, from what `$.mcp.call` returned. */
export function readAnswer(result: CallResult): Answer {
  const text = result.content
    .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
    .join("\n")
    .trim();
  // An error result is Tonen not answering (a restart, a dropped
  // connection): Tonen's own refusals come as `refused`.
  if (result.isError) return { kind: "failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "waiting" };
  }
  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed))
    return { kind: "waiting" };
  const { kind } = parsed;
  if (kind === "mention") {
    if (
      "projectId" in parsed &&
      typeof parsed.projectId === "string" &&
      "commentId" in parsed &&
      typeof parsed.commentId === "string" &&
      "prompt" in parsed &&
      typeof parsed.prompt === "string"
    ) {
      return {
        kind,
        projectId: parsed.projectId,
        commentId: parsed.commentId,
        prompt: parsed.prompt,
        // A Tonen from before the notice still hands over its mentions.
        notice:
          "notice" in parsed && typeof parsed.notice === "string"
            ? parsed.notice
            : "You were mentioned (@Claude) on your site.",
      };
    }
    return { kind: "waiting" };
  }
  if (kind === "restarting" || kind === "replaced" || kind === "stopped") return { kind };
  if (kind === "refused") {
    const message = "message" in parsed && typeof parsed.message === "string" ? parsed.message : "";
    return { kind, message: message || "Tonen refused to listen" };
  }
  return { kind: "waiting" };
}

/**
 * How long to wait before calling again after `failures` failures in a row:
 * 2 s, doubling, at most a minute.
 */
export const delayAfter = (failures: number) =>
  Math.min(60_000, 2_000 * 2 ** Math.max(0, failures - 1));
