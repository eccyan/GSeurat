// ── DebugDumpRegistry: On-demand self-reporting aggregator ──
// Zero runtime cost — state gathering only fires on explicit trigger.

import type {
  DebugDomain,
  DebugDumpEnvelope,
  DebugDumpSource,
  EarsDump,
  EyesComponentNode,
  EyesDump,
  IDebugDumpable,
  StoreDump,
} from "./types.js";

// Empty sentinel objects — avoids allocations when a domain has no registrants.
const EMPTY_EYES: EyesDump = { components: [] };
const EMPTY_EARS: EarsDump = {
  global: {
    master_volume: 0,
    sample_rate: 0,
    max_polyphony: 0,
    active_voice_count: 0,
    active_group_count: 0,
    dropped_commands: 0,
  },
  track_groups: [],
  voices: [],
  warnings: [],
};

export class DebugDumpRegistry {
  private static instance: DebugDumpRegistry | null = null;

  private readonly modules = new Set<IDebugDumpable>();
  private source: DebugDumpSource = "bricklayer";

  private constructor() {}

  /** Singleton accessor — registry is created once per JS runtime. */
  static getInstance(): DebugDumpRegistry {
    if (!DebugDumpRegistry.instance) {
      DebugDumpRegistry.instance = new DebugDumpRegistry();
    }
    return DebugDumpRegistry.instance;
  }

  /** Set the source identifier for this tool (call once at app init). */
  setSource(source: DebugDumpSource): void {
    this.source = source;
  }

  // ── Registration ──

  register(module: IDebugDumpable): void {
    this.modules.add(module);
  }

  unregister(module: IDebugDumpable): void {
    this.modules.delete(module);
  }

  // ── Collection (on-demand only) ──

  /**
   * Gather state from all registered modules and assemble the envelope.
   * This is the ONLY method that triggers serialization work.
   */
  collectAll(): DebugDumpEnvelope {
    const eyesComponents: EyesComponentNode[] = [];
    let earsDump: EarsDump | null = null;
    const storeDumps: StoreDump[] = [];

    for (const mod of this.modules) {
      const state = mod.dumpDebugState();

      if (mod.debugDomain === "eyes") {
        // Eyes modules return EyesComponentNode[]
        eyesComponents.push(...(state as EyesComponentNode[]));
      } else if (mod.debugDomain === "ears") {
        // Ears modules return EarsDump — merge if multiple
        const dump = state as EarsDump;
        if (!earsDump) {
          earsDump = dump;
        } else {
          earsDump.track_groups.push(...dump.track_groups);
          earsDump.voices.push(...dump.voices);
          earsDump.warnings.push(...dump.warnings);
          // Keep the first global state (primary audio module wins)
        }
      } else {
        // Store modules return StoreDump
        storeDumps.push(state as StoreDump);
      }
    }

    return {
      version: 1,
      timestamp_ms: Date.now(),
      source: this.source,
      eyes: eyesComponents.length > 0 ? { components: eyesComponents } : EMPTY_EYES,
      ears: earsDump ?? EMPTY_EARS,
      store: storeDumps,
    };
  }

  /**
   * Collect from a single domain only.
   * Useful when debugging just UI or just audio.
   */
  collectDomain(domain: DebugDomain): EyesDump | EarsDump | StoreDump[] {
    if (domain === "eyes") {
      const components: EyesComponentNode[] = [];
      for (const mod of this.modules) {
        if (mod.debugDomain === "eyes") {
          components.push(...(mod.dumpDebugState() as EyesComponentNode[]));
        }
      }
      return { components };
    }

    if (domain === "store") {
      const stores: StoreDump[] = [];
      for (const mod of this.modules) {
        if (mod.debugDomain === "store") {
          stores.push(mod.dumpDebugState() as StoreDump);
        }
      }
      return stores;
    }

    // ears
    let earsDump: EarsDump | null = null;
    for (const mod of this.modules) {
      if (mod.debugDomain !== "ears") continue;
      const dump = mod.dumpDebugState() as EarsDump;
      if (!earsDump) {
        earsDump = dump;
      } else {
        earsDump.track_groups.push(...dump.track_groups);
        earsDump.voices.push(...dump.voices);
        earsDump.warnings.push(...dump.warnings);
      }
    }
    return earsDump ?? EMPTY_EARS;
  }

  // ── Convenience: dump + clipboard + console ──

  /**
   * Collect all state, log to console, and copy to clipboard.
   * Returns the envelope for programmatic use.
   */
  async dumpToClipboard(): Promise<DebugDumpEnvelope> {
    const envelope = this.collectAll();
    const json = JSON.stringify(envelope, null, 2);

    // eslint-disable-next-line no-console
    console.log("[DebugDump]", json);

    try {
      await navigator.clipboard.writeText(json);
      // eslint-disable-next-line no-console
      console.log("[DebugDump] Copied to clipboard.");
    } catch {
      // Clipboard API may fail in non-secure contexts — JSON is still in console.
      console.warn("[DebugDump] Clipboard write failed — see console output above.");
    }

    return envelope;
  }
}

// ── Global trigger for console / DevTools access ──

declare global {
  interface Window {
    __DEBUG_DUMP__?: () => Promise<DebugDumpEnvelope>;
  }
}

/**
 * Install the global trigger. Call once at app init:
 *
 *   installDebugDumpGlobal();
 *
 * Then from DevTools console:
 *
 *   await window.__DEBUG_DUMP__()
 */
export function installDebugDumpGlobal(): void {
  if (typeof window !== "undefined") {
    window.__DEBUG_DUMP__ = () => DebugDumpRegistry.getInstance().dumpToClipboard();
  }
}

/**
 * Install the keyboard shortcut (Ctrl+Shift+D).
 * Call once at app init alongside installDebugDumpGlobal().
 */
export function installDebugDumpKeyboard(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === "D") {
      e.preventDefault();
      void DebugDumpRegistry.getInstance().dumpToClipboard();
    }
  });
}
