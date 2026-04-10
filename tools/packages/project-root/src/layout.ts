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
  return p.startsWith('assets/') && !p.includes('..');
}

export function isToolsDataPath(p: string): boolean {
  return p.startsWith('tools_data/') && !p.includes('..');
}
