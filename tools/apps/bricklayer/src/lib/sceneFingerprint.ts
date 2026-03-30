/**
 * Scene fingerprint for incremental auto-sync.
 *
 * A "structural" change requires full PLY reload (load_scene_json):
 *   - ply_file changed
 *   - camera changed
 *   - placed objects changed (add/remove/ply_file/transform)
 *   - render resolution changed
 *
 * Everything else (lights, emitters, animations, VFX) is a "property" change
 * that can use the lightweight update_scene_data command.
 */

export interface SceneFingerprint {
  ply_file: string;
  camera_json: string;
  objects_json: string;
  render_width: number;
  render_height: number;
}

export function computeFingerprint(scene: Record<string, unknown>): SceneFingerprint {
  const gs = (scene.gaussian_splat ?? {}) as Record<string, unknown>;
  return {
    ply_file: (gs.ply_file as string) ?? '',
    camera_json: gs.camera ? JSON.stringify(gs.camera) : '',
    objects_json: scene.objects ? JSON.stringify(scene.objects) : '',
    render_width: (gs.render_width as number) ?? 320,
    render_height: (gs.render_height as number) ?? 240,
  };
}

export function fingerprintsEqual(a: SceneFingerprint, b: SceneFingerprint): boolean {
  return (
    a.ply_file === b.ply_file &&
    a.camera_json === b.camera_json &&
    a.objects_json === b.objects_json &&
    a.render_width === b.render_width &&
    a.render_height === b.render_height
  );
}

export function isStructuralChange(
  prev: SceneFingerprint | null,
  next: SceneFingerprint,
): boolean {
  if (!prev) return true;
  return !fingerprintsEqual(prev, next);
}
