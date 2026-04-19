import type { EarsDump, IDebugDumpable } from '@gseurat/debug-dump';
import { useWeaverStore } from '../store/useWeaverStore.js';

/**
 * Weaver "ears" domain dumper — reports audio playback state on demand.
 * Registered once at app init; zero cost until Ctrl+Shift+D is pressed.
 */
export class WeaverEarsDumper implements IDebugDumpable {
  readonly debugDomain = 'ears' as const;
  readonly debugName = 'WeaverAudioPlayer';

  dumpDebugState(): EarsDump {
    const s = useWeaverStore.getState();
    const warnings: string[] = [];

    // Flag common issues
    const anySoloed = s.stems.some((st) => st.soloed);
    if (anySoloed) {
      const mutedBySolo = s.stems.filter((st) => !st.soloed && !st.muted).length;
      if (mutedBySolo > 0) warnings.push(`${mutedBySolo} stem(s) silenced by solo`);
    }
    if (s.loopEnabled && s.loopEnd > s.loopStart && s.loopEnd - s.loopStart < 4410) {
      warnings.push('loop_region_too_small');
    }
    if (s.stems.length > 0 && s.stems.every((st) => st.muted)) {
      warnings.push('all_stems_muted');
    }

    return {
      global: {
        master_volume: 1.0,
        sample_rate: s.sampleRate,
        max_polyphony: s.stems.length,
        active_voice_count: s.stems.filter((st) => st.audioBuffer !== null).length,
        active_group_count: s.isPlaying ? 1 : 0,
        dropped_commands: 0,
      },
      track_groups: s.activeGroupId
        ? [
            {
              group_id: 0,
              status: s.isPlaying ? 'Playing' : 'Idle',
              play_cursor_frames: s.playheadFrame,
              loop_start: s.loopStart,
              loop_end: s.loopEnd,
              group_volume: 1.0,
              stems: s.stems
                .filter((st) => st.audioBuffer !== null)
                .map((st, i) => ({
                  index: i,
                  asset_ref: st.sourcePath,
                  volume: st.muted ? 0 : (anySoloed && !st.soloed) ? 0 : st.initialVolume,
                  adsr: null,
                })),
            },
          ]
        : [],
      voices: [],
      warnings,
    };
  }
}
