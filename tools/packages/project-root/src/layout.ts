export const PROJECT_LAYOUT = {
  assets: {
    characters: 'assets/characters',
    vfx:        'assets/vfx',
    vfxPresets: 'assets/vfx/presets',
    scenes:     'assets/scenes',
    maps:       'assets/maps',
    textures:   'assets/textures',
    audio:      'assets/audio',
    components: 'assets/components',
  },
  toolsData: {
    bricklayer:   'tools_data/bricklayer',
    melies:       'tools_data/melies_projects',
    echidnaSaves: 'tools_data/echidna_saves',
    cache:        'tools_data/cache',
  },
} as const;

// Note: 'components' is intentionally excluded. It holds editor schema JSON
// (schemas/*.schema.json), not engine-facing runtime assets. Consumers that
// need the components directory should use PROJECT_LAYOUT.assets.components directly.
export const ASSET_KINDS = [
  'characters',
  'vfx',
  'scenes',
  'maps',
  'textures',
  'audio',
] as const;

export type AssetKind = typeof ASSET_KINDS[number];

export function isAssetPath(p: string): boolean {
  const segments = p.split('/');
  return segments[0] === 'assets' && !segments.includes('..');
}

export function isToolsDataPath(p: string): boolean {
  const segments = p.split('/');
  return segments[0] === 'tools_data' && !segments.includes('..');
}
