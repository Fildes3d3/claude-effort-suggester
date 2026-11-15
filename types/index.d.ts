export type Level = 'low' | 'medium' | 'high' | 'max'

export type Suggestion = { level: Level; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'effort-suggester': {
      /** The suggestion for the last prompt, until applied or dismissed. */
      suggestion: Suggestion | null
      /** The session's own effort: what the main loop's last request came at. */
      sessionEffort: string | null
      /**
       * The level the person last applied and the one before it, for Undo.
       * While `isPending` its `/effort` has not landed and the mod sends it.
       */
      applied: { level: Level; previous: string; isPending: boolean } | null
      isOn: boolean
    }
  }
}
