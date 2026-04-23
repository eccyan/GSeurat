import { useComponentRegistry } from '@gseurat/ui-kit';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';
import { CameraVolumeEditor } from './CameraVolumeEditor.js';
import { CameraTriggerEditor } from './CameraTriggerEditor.js';
import { CameraRailEditor } from './CameraRailEditor.js';
import {
  GameObjectProperties,
  LightProperties,
  GsEmitterProperties,
  GsAnimationProperties,
  AudioZoneProperties,
  VfxInstanceProperties,
} from './editors/index.js';

const styles = { ...panelStyles };

export function ScenePropertiesPanel() {
  useComponentRegistry('ScenePropertiesPanel');
  const selectedEntity = useSceneStore((s) => s.selectedEntity);
  const gameObjects = useSceneStore((s) => s.gameObjects);
  const staticLights = useSceneStore((s) => s.staticLights);
  const gsParticleEmitters = useSceneStore((s) => s.gsParticleEmitters);
  const gsAnimations = useSceneStore((s) => s.gsAnimations);
  const vfxInstances = useSceneStore((s) => s.vfxInstances);
  const cameraVolumes = useSceneStore((s) => s.cameraVolumes);
  const cameraTriggers = useSceneStore((s) => s.cameraTriggers);
  const cameraRails = useSceneStore((s) => s.cameraRails);
  const audioZones = useSceneStore((s) => s.audioZones);

  const content = (() => {
    if (!selectedEntity) {
      return <div style={styles.empty}>Select an entity in the scene tree</div>;
    }

    if (selectedEntity.type === 'game_object') {
      const obj = gameObjects.find((o) => o.id === selectedEntity.id);
      if (!obj) return <div style={styles.empty}>Game object not found</div>;
      return <GameObjectProperties obj={obj} />;
    }

    if (selectedEntity.type === 'light') {
      const light = staticLights.find((l) => l.id === selectedEntity.id);
      if (!light) return <div style={styles.empty}>Light not found</div>;
      return <LightProperties light={light} />;
    }

    if (selectedEntity.type === 'gs_emitter') {
      const emitter = gsParticleEmitters.find((e) => e.id === selectedEntity.id);
      if (!emitter) return <div style={styles.empty}>Emitter not found</div>;
      return <GsEmitterProperties emitter={emitter} />;
    }

    if (selectedEntity.type === 'gs_animation') {
      const anim = gsAnimations.find((a) => a.id === selectedEntity.id);
      if (!anim) return <div style={styles.empty}>Animation not found</div>;
      return <GsAnimationProperties anim={anim} />;
    }

    if (selectedEntity.type === 'vfx_instance') {
      const vfx = vfxInstances.find((v) => v.id === selectedEntity.id);
      if (!vfx) return <div style={styles.empty}>VFX instance not found</div>;
      return <VfxInstanceProperties vfx={vfx} />;
    }

    if (selectedEntity.type === 'camera_volume') {
      const vol = cameraVolumes.find((v) => v.id === selectedEntity.id);
      if (!vol) return <div style={styles.empty}>Camera volume not found</div>;
      return <CameraVolumeEditor volume={vol} />;
    }

    if (selectedEntity.type === 'camera_trigger') {
      const trig = cameraTriggers.find((t) => t.id === selectedEntity.id);
      if (!trig) return <div style={styles.empty}>Camera trigger not found</div>;
      return <CameraTriggerEditor trigger={trig} />;
    }

    if (selectedEntity.type === 'camera_rail') {
      const rail = cameraRails.find((r) => r.id === selectedEntity.id);
      if (!rail) return <div style={styles.empty}>Camera rail not found</div>;
      return <CameraRailEditor rail={rail} />;
    }

    if (selectedEntity.type === 'audio_zone') {
      const zone = audioZones.find((z) => z.id === selectedEntity.id);
      if (!zone) return <div style={styles.empty}>Audio zone not found</div>;
      return <AudioZoneProperties zone={zone} />;
    }

    return <div style={styles.empty}>Unknown entity type</div>;
  })();

  return (
    <div data-panel-id="scene-properties-panel">
      {content}
    </div>
  );
}
