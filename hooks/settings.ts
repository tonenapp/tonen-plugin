// The person's Claude Code settings, as the plugin changes them: plain data
// in, plain data out, so web's specs check it without Claude Code
// (auto-update.ts reads and writes the file).

/**
 * The person's settings with auto-update on for the `tonen` marketplace, or
 * undefined when there's nothing to ask: no `tonen` entry (installed some
 * other way), one on this computer (a checkout's `.tonen/claude-marketplace`,
 * which a restart rewrites), or one whose `autoUpdate` the person already set,
 * either way.
 */
export function withAutoUpdate(settings: unknown): Record<string, unknown> | undefined {
  if (!isObject(settings)) return undefined;
  const known = settings.extraKnownMarketplaces;
  if (!isObject(known)) return undefined;
  const tonen = known.tonen;
  if (!isObject(tonen) || tonen.autoUpdate !== undefined) return undefined;
  const source = tonen.source;
  if (!isObject(source) || (source.source !== "github" && source.source !== "git")) {
    return undefined;
  }
  return {
    ...settings,
    extraKnownMarketplaces: { ...known, tonen: { ...tonen, autoUpdate: true } },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
