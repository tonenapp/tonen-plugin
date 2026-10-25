import type { EngineInterface } from "claude-code";
import { withAutoUpdate } from "./settings.ts";

// Keeping the plugin up to date. Claude Code updates a marketplace's plugins
// by itself only when that marketplace's auto-update is on, and it's off for
// every marketplace but Anthropic's, Tonen's too; no field in the plugin turns
// it on. So the plugin asks its person once, after the first turn of their
// first session (not as it opens, where Enter on a first prompt would answer
// it), and on a
// yes sets `autoUpdate` on the `tonen` entry that `claude plugin marketplace
// add` wrote into their settings (`extraKnownMarketplaces`), the key Claude
// Code's own toggle under /plugin writes there too. Claude Code then refreshes
// the marketplace in the background a while after a session's first message,
// and the new version loads with the next session.

/** Where the plugin keeps that it asked (`$.store`, across sessions): once, whatever the answer. */
const ASKED = "autoUpdateAsked";

/** Asks once whether Claude Code may keep the plugin up to date, and turns that on at a yes. */
export async function offerAutoUpdate($: EngineInterface) {
  if ((await $.store.get(ASKED)) !== undefined) return;
  const path = await settingsPath($);
  if (!path || !withAutoUpdate(await readJson($, path))) return;
  const yes = "Keep it up to date";
  const answer = await $.ui
    .ask(
      "Keep Tonen's plugin up to date by itself? Claude Code then updates it in the background, as it does Anthropic's own plugins, and the new version loads with your next session.",
      { options: [yes, "Not now"], header: "Tonen" },
    )
    .catch(() => undefined);
  // Dismissed (no answer) asks again next session; an answer is kept, a
  // yes once it's written, so one that couldn't be asks again.
  if (answer === undefined) return;
  if (answer !== yes) {
    await $.store.set(ASKED, false);
    return;
  }
  // Read again: the file may have changed while the question was up.
  const next = withAutoUpdate(await readJson($, path));
  if (next) {
    const wrote = await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`).then(
      () => true,
      (error: unknown) => {
        $.ui.log(`Tonen's plugin couldn't write ${path}: ${String(error)}`, { to: "debug" });
        return false;
      },
    );
    if (!wrote) {
      $.ui.toast("Tonen couldn't turn on its updates: /plugin, Marketplaces, tonen does it.");
      return;
    }
  }
  await $.store.set(ASKED, true);
  $.ui.toast("Claude Code keeps Tonen's plugin up to date now.");
}

// ~/.claude/settings.json, or the one in CLAUDE_CONFIG_DIR when that's set.
async function settingsPath($: EngineInterface): Promise<string | undefined> {
  const dir = await $.env.get("CLAUDE_CONFIG_DIR");
  if (dir) return `${dir}/settings.json`;
  const home = await $.env.get("HOME");
  return home ? `${home}/.claude/settings.json` : undefined;
}

/** A file's JSON, or undefined when it's missing or isn't JSON. */
async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    const json: unknown = JSON.parse(await $.fs.read(path));
    return json;
  } catch {
    return undefined;
  }
}
