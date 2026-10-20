// The plugin's values in the session's state (`$.state`): what the band above
// the prompt draws. Claude Code reads this contract when it loads the mod
// (plugin.json's "types").

/** Listening, with the project's comments left to fix; null while it isn't. */
export type Band = { toFix: number } | null;

declare module "claude-code" {
  interface PluginState {
    tonen: { band: Band };
  }
}
