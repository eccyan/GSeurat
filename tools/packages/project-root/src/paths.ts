import type { AssetKind } from './layout';

export type AssetRef =
  | { kind: 'id'; id: string }
  | { kind: 'path'; path: string };

const PART_SEPARATOR_RE = /[/\\]/;

/**
 * Build an asset path like `assets/characters/walker/walker.ply`.
 * All parts are joined with `/`. Each part must be non-empty, contain no
 * separators, and not be a traversal segment.
 */
export function toAssetPath(kind: AssetKind, ...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error(`toAssetPath: at least one part required for kind=${kind}`);
  }
  for (const p of parts) {
    if (p.length === 0) {
      throw new Error(`toAssetPath: empty part not allowed (kind=${kind})`);
    }
    if (PART_SEPARATOR_RE.test(p)) {
      throw new Error(`toAssetPath: part contains separator: "${p}"`);
    }
    if (isTraversalSegment(p)) {
      throw new Error(`toAssetPath: traversal segment not allowed: "${p}"`);
    }
  }
  return `assets/${kind}/${parts.join('/')}`;
}

function isTraversalSegment(segment: string): boolean {
  return segment === '..' || segment === '.';
}

function hasTraversalSegment(s: string): boolean {
  const segments = s.split(/[/\\]/);
  return segments.some(isTraversalSegment);
}

function isAbsolute(s: string): boolean {
  if (s.startsWith('/')) return true;
  // Windows drive letter: C:/foo, D:\foo
  if (/^[A-Za-z]:[/\\]/.test(s)) return true;
  return false;
}

/**
 * Parse an asset reference string into its discriminated-union form.
 * Accepts `#id` (registry ID) or `assets/...` (project-relative path).
 * Throws on any other form or on traversal.
 */
export function parseAssetRef(s: string): AssetRef {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('parseAssetRef: expected "#id" or "assets/..." but got empty string');
  }
  if (s.startsWith('#')) {
    const id = s.slice(1);
    if (id.length === 0 || PART_SEPARATOR_RE.test(id)) {
      throw new Error(`parseAssetRef: invalid id: "${s}"`);
    }
    return { kind: 'id', id };
  }
  if (isAbsolute(s)) {
    throw new Error(`parseAssetRef: absolute path not allowed: "${s}"`);
  }
  if (hasTraversalSegment(s)) {
    throw new Error(`parseAssetRef: traversal not allowed: "${s}"`);
  }
  if (s.startsWith('tools_data/')) {
    throw new Error(`parseAssetRef: not an asset path (tools_data): "${s}"`);
  }
  if (!s.startsWith('assets/')) {
    throw new Error(`parseAssetRef: bare filename not allowed: "${s}"`);
  }
  // assets/ must be followed by {kind}/{name} at minimum
  const afterAssets = s.slice('assets/'.length);
  if (afterAssets.length === 0 || !afterAssets.includes('/')) {
    throw new Error(
      `parseAssetRef: path must be "assets/{kind}/{name}" with at least two segments, got: "${s}"`
    );
  }
  return { kind: 'path', path: s };
}

/** Returns true if `s` is a valid asset ref (`#id` or `assets/...`). */
export function isAssetRef(s: string): boolean {
  try {
    parseAssetRef(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns null if `s` is a valid asset ref, or a human-readable error message.
 * Useful for validators that want to report why a ref was rejected.
 */
export function validateAssetRef(s: string): string | null {
  try {
    parseAssetRef(s);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
