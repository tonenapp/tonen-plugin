import type { EngineInterface } from "claude-code";

// What listening and sharing both hand the session: the plugin's status line,
// and turns of their own (a mention, a local site that came up or ended).
//
// Claude Code draws a plugin's status as a warning (⚠), so each part is only
// what needs the person now, and one part's words never wipe out another's:
// listening has one part, and each shared port its own.

type Part = "listen" | `share:${number}`;
const parts = new Map<Part, string>();

/** Sets `part`'s words in the status line, or takes them down (`undefined`). */
export function showStatus($: EngineInterface, part: Part, text: string | undefined) {
  if (text === undefined) parts.delete(part);
  else parts.set(part, text);
  $.ui.status(parts.size === 0 ? undefined : [...parts.values()].join(" · "));
}

// Turns the session refused for now (the person pressed Esc), handed over
// again when its next turn ends. A reload of the module starts it over.
const unsent: string[] = [];

/** Hands `prompt` to the session as a turn of its own once it's idle; kept for `handUnsent` when the session refuses it now. */
export async function hand($: EngineInterface, prompt: string) {
  const submitted = await $.prompt.submit({ text: prompt });
  if (submitted.drop !== undefined) unsent.push(prompt);
}

/** Hands over again what the session refused before: call it when a turn ends. */
export function handUnsent($: EngineInterface) {
  for (const prompt of unsent.splice(0)) void hand($, prompt);
}
