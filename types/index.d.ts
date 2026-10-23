// The plugin's values in the session's state (`$.state`): what the band above
// the prompt draws. Claude Code reads this contract when it loads the mod
// (plugin.json's "types").

/** Listening, with the project's comments left to fix; null while it isn't. */
export type Band = { toFix: number } | null;

/**
 * The local sites the plugin shares in this session, one a line on the band
 * (`Shared` in hooks/local-site.ts, the same shape): the port, the address
 * once it's up, how many viewed it lately, and what's wrong now.
 */
export type Sharing = readonly {
  port: number;
  address: string | null;
  viewers: number;
  note: string | null;
}[];

declare module "claude-code" {
  interface PluginState {
    tonen: { band: Band; sharing: Sharing };
  }
}
