import React from 'react';
import { useComponentRegistry } from '@gseurat/ui-kit';
import { chunkGridKey, ensureSubdir, writeFileAtPath } from '@gseurat/project-root';
import { NumberInput } from '../components/NumberInput.js';
import { Vec3Input } from '../components/Vec3Input.js';
import { useWorldStore } from '../store/useWorldStore.js';
import { useSceneStore } from '../store/useSceneStore.js';
import { panelStyles } from '../styles/panel.js';
import { switchScene, importEngineScene } from '../lib/projectIO.js';

const styles = { ...panelStyles };

const sectionStyle: React.CSSProperties = {
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  marginBottom: 3,
  display: 'block',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 8,
};

const fullInputStyle: React.CSSProperties = {
  ...styles.input,
  flex: 1,
};

const enterBtnStyle: React.CSSProperties = {
  background: '#334',
  border: '1px solid #555',
  color: '#ccf',
  borderRadius: 4,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 11,
  width: '100%',
  marginTop: 4,
};

// ── Section header ──

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.5,
      color: '#88aacc',
      textTransform: 'uppercase',
      borderBottom: '1px solid #333',
      paddingBottom: 4,
      marginBottom: 8,
    }}>
      {label}
    </div>
  );
}

// ── World Settings ──

function WorldSettingsEditor() {
  const gridCellSize = useWorldStore((s) => s.manifest.grid_cell_size);
  const setGridCellSize = useWorldStore((s) => s.setGridCellSize);
  const startInstance = useWorldStore((s) => s.manifest.start_instance);
  const instances = useWorldStore((s) => s.manifest.instances);
  const updateManifest = useWorldStore((s) => s.updateStartInstance);

  return (
    <div style={sectionStyle}>
      <SectionHeader label="World Settings" />
      <label style={labelStyle}>Grid Cell Size</label>
      <Vec3Input
        value={gridCellSize}
        onChange={(v) => setGridCellSize(v as [number, number, number])}
        step={1}
        min={1}
      />

      <label style={labelStyle}>Start Instance</label>
      <div style={rowStyle}>
        <select
          value={startInstance ?? ''}
          onChange={(e) => updateManifest(e.target.value || undefined)}
          style={{ ...styles.input, flex: 1 }}
        >
          <option value="">-- None (use chunk grid) --</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.display_name || inst.id}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Chunk Editor ──

function ChunkEditor({ gridKey }: { gridKey: string }) {
  const chunk = useWorldStore((s) => s.manifest.chunks.find((c) => chunkGridKey(c.grid) === gridKey));
  const updateChunk = useWorldStore((s) => s.updateChunk);
  const enterChunk = useWorldStore((s) => s.enterChunk);

  if (!chunk) return null;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Chunk" />

      <label style={labelStyle}>Grid Position</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>
        [{chunk.grid[0]}, {chunk.grid[1]}, {chunk.grid[2]}]
      </div>

      <label style={labelStyle}>PLY File</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={chunk.ply_file}
          placeholder="path/to/chunk.ply"
          onChange={(e) => updateChunk(gridKey, { ply_file: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>Scene File</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={chunk.scene_file ?? ''}
          placeholder="path/to/scene.json"
          onChange={(e) => updateChunk(gridKey, { scene_file: e.target.value || undefined })}
          style={fullInputStyle}
        />
      </div>

      <button
        style={enterBtnStyle}
        onClick={async () => {
          const handle = useSceneStore.getState().projectHandle;
          if (!handle) {
            alert('Open a project directory first');
            return;
          }
          if (!chunk.scene_file) {
            alert('No scene file specified for this chunk');
            return;
          }
          const ok = await switchScene(handle, chunk.scene_file);
          if (ok) {
            const worldStore = useWorldStore.getState();
            worldStore.setEditingContext({ type: 'chunk', gridKey, sceneFile: chunk.scene_file });
            enterChunk(chunk.grid);
          }
        }}
      >
        Enter Chunk
      </button>
      <button
        style={{ ...enterBtnStyle, marginTop: 8, background: '#2a3a2a', borderColor: '#4a6a4a' }}
        onClick={async () => {
          const handle = useSceneStore.getState().projectHandle;
          if (!handle) { alert('Open a project directory first'); return; }
          try {
            const [fileHandle] = await (window as any).showOpenFilePicker({
              types: [{ description: 'Scene JSON', accept: { 'application/json': ['.json'] } }],
              multiple: false,
            });
            const file = await fileHandle.getFile();
            const confirmed = window.confirm(
              `Import "${file.name}" into this chunk?\n\nThis will overwrite any current scene data.`
            );
            if (!confirmed) return;
            // Write the picked file into the project so importEngineScene can read it
            const sceneFile = chunk.scene_file || `assets/scenes/${file.name}`;
            await ensureSubdir(handle, 'assets/scenes');
            await writeFileAtPath(handle, sceneFile, await file.text());
            // Update chunk scene_file if it was empty
            if (!chunk.scene_file) updateChunk(gridKey, { scene_file: sceneFile });
            const ok = await importEngineScene(handle, sceneFile);
            if (ok) {
              const worldStore = useWorldStore.getState();
              worldStore.setEditingContext({ type: 'chunk', gridKey, sceneFile });
              enterChunk(chunk.grid);
            }
          } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
              console.error('Import failed:', err);
              alert(`Import failed: ${err.message}`);
            }
          }
        }}
      >
        Import Scene JSON
      </button>
    </div>
  );
}

// ── Streaming Volume Editor ──

function StreamingVolumeEditor({ id }: { id: string }) {
  const sv = useWorldStore((s) => s.manifest.streaming_volumes.find((v) => v.id === id));
  const updateStreamingVolume = useWorldStore((s) => s.updateStreamingVolume);

  if (!sv) return null;

  const halfExtents: [number, number, number] = sv.half_extents ?? [8, 8, 8];
  const radius = sv.radius ?? 8;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Streaming Volume" />

      <label style={labelStyle}>ID</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>{sv.id}</div>

      <label style={labelStyle}>Shape</label>
      <div style={rowStyle}>
        <select
          value={sv.shape}
          onChange={(e) => updateStreamingVolume(id, { shape: e.target.value as 'box' | 'sphere' })}
          style={{ ...styles.input, flex: 1 }}
        >
          <option value="box">Box</option>
          <option value="sphere">Sphere</option>
        </select>
      </div>

      <label style={labelStyle}>Position</label>
      <Vec3Input
        value={sv.position}
        onChange={(v) => updateStreamingVolume(id, { position: v as [number, number, number] })}
        step={0.5}
      />

      {sv.shape === 'box' ? (
        <>
          <label style={labelStyle}>Half Extents</label>
          <Vec3Input
            value={halfExtents}
            onChange={(v) => updateStreamingVolume(id, { half_extents: v as [number, number, number] })}
            step={0.5}
            min={0.1}
          />
        </>
      ) : (
        <>
          <label style={labelStyle}>Radius</label>
          <div style={rowStyle}>
            <NumberInput
              value={radius}
              min={0.1}
              step={0.5}
              onChange={(v) => updateStreamingVolume(id, { radius: v })}
              style={{ ...styles.input, flex: 1 }}
            />
          </div>
        </>
      )}

      <label style={labelStyle}>Preload Target IDs (comma-separated)</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={sv.preload_target_ids.join(', ')}
          placeholder="chunk_key_1, chunk_key_2"
          onChange={(e) => {
            const ids = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            updateStreamingVolume(id, { preload_target_ids: ids });
          }}
          style={fullInputStyle}
        />
      </div>
    </div>
  );
}

// ── Instance Editor ──

function InstanceEditor({ id }: { id: string }) {
  const inst = useWorldStore((s) => s.manifest.instances.find((i) => i.id === id));
  const updateInstance = useWorldStore((s) => s.updateInstance);

  if (!inst) return null;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Instance" />

      <label style={labelStyle}>ID</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>{inst.id}</div>

      <label style={labelStyle}>Display Name</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={inst.display_name}
          placeholder="Instance name"
          onChange={(e) => updateInstance(id, { display_name: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>Scene File</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={inst.scene_file}
          placeholder="assets/scenes/room.json"
          onChange={(e) => updateInstance(id, { scene_file: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>PLY File</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={inst.ply_file ?? ''}
          placeholder="assets/maps/room.ply"
          onChange={(e) => updateInstance(id, { ply_file: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <button
        style={enterBtnStyle}
        onClick={async () => {
          const handle = useSceneStore.getState().projectHandle;
          if (!handle) {
            alert('Open a project directory first');
            return;
          }
          if (!inst.scene_file) {
            alert('No scene file specified for this instance');
            return;
          }
          const ok = await switchScene(handle, inst.scene_file);
          if (ok) {
            useWorldStore.getState().setEditingContext({ type: 'instance', id, sceneFile: inst.scene_file });
          }
        }}
      >
        Enter Instance
      </button>
      <button
        style={{ ...enterBtnStyle, marginTop: 8, background: '#2a3a2a', borderColor: '#4a6a4a' }}
        onClick={async () => {
          const handle = useSceneStore.getState().projectHandle;
          if (!handle) { alert('Open a project directory first'); return; }
          try {
            const [fileHandle] = await (window as any).showOpenFilePicker({
              types: [{ description: 'Scene JSON', accept: { 'application/json': ['.json'] } }],
              multiple: false,
            });
            const file = await fileHandle.getFile();
            const confirmed = window.confirm(
              `Import "${file.name}" into this instance?\n\nThis will overwrite any current scene data.`
            );
            if (!confirmed) return;
            const sceneFile = inst.scene_file || `assets/scenes/${file.name}`;
            await ensureSubdir(handle, 'assets/scenes');
            await writeFileAtPath(handle, sceneFile, await file.text());
            if (!inst.scene_file) updateInstance(id, { scene_file: sceneFile });
            const ok = await importEngineScene(handle, sceneFile);
            if (ok) {
              useWorldStore.getState().setEditingContext({ type: 'instance', id, sceneFile });
            }
          } catch (err) {
            if (err instanceof Error && err.name !== 'AbortError') {
              console.error('Import failed:', err);
              alert(`Import failed: ${err.message}`);
            }
          }
        }}
      >
        Import Scene JSON
      </button>
    </div>
  );
}

// ── Portal Editor ──

function PortalEditor({ id }: { id: string }) {
  const portal = useWorldStore((s) => s.manifest.portals.find((p) => p.id === id));
  const updatePortal = useWorldStore((s) => s.updatePortal);
  const instances = useWorldStore((s) => s.manifest.instances);
  const chunks = useWorldStore((s) => s.manifest.chunks);

  if (!portal) return null;

  return (
    <div style={sectionStyle}>
      <SectionHeader label="Portal" />

      <label style={labelStyle}>ID</label>
      <div style={{ ...rowStyle, color: '#888', fontSize: 12, marginBottom: 8 }}>{portal.id}</div>

      <label style={labelStyle}>Display Name</label>
      <div style={rowStyle}>
        <input
          type="text"
          value={portal.display_name}
          placeholder="Portal name"
          onChange={(e) => updatePortal(id, { display_name: e.target.value })}
          style={fullInputStyle}
        />
      </div>

      <label style={labelStyle}>Position</label>
      <Vec3Input
        value={portal.position}
        onChange={(v) => updatePortal(id, { position: v as [number, number, number] })}
        step={0.5}
      />

      <label style={labelStyle}>Half Extents</label>
      <Vec3Input
        value={portal.half_extents}
        onChange={(v) => updatePortal(id, { half_extents: v as [number, number, number] })}
        step={0.1}
        min={0.1}
      />

      <label style={labelStyle}>Source Chunk</label>
      <div style={rowStyle}>
        <select
          value={portal.source_chunk}
          onChange={(e) => updatePortal(id, { source_chunk: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        >
          <option value="">-- Select chunk --</option>
          {chunks.map((c) => {
            const key = chunkGridKey(c.grid);
            return <option key={key} value={key}>[{c.grid[0]}, {c.grid[1]}, {c.grid[2]}]</option>;
          })}
        </select>
      </div>

      <label style={labelStyle}>Target Instance</label>
      <div style={rowStyle}>
        <select
          value={portal.target_instance}
          onChange={(e) => updatePortal(id, { target_instance: e.target.value })}
          style={{ ...styles.input, flex: 1 }}
        >
          <option value="">-- Select instance --</option>
          {instances.map((inst) => (
            <option key={inst.id} value={inst.id}>{inst.display_name || inst.id}</option>
          ))}
        </select>
      </div>

      <label style={labelStyle}>Target Spawn Point</label>
      <Vec3Input
        value={portal.target_spawn}
        onChange={(v) => updatePortal(id, { target_spawn: v as [number, number, number] })}
        step={0.5}
      />
    </div>
  );
}

// ── WorldPropertiesPanel ──

export function WorldPropertiesPanel() {
  useComponentRegistry('WorldPropertiesPanel');

  const selectedEntity = useWorldStore((s) => s.selectedEntity);

  return (
    <div style={{ color: '#ccc', fontSize: 12 }}>
      <WorldSettingsEditor />

      {selectedEntity?.type === 'chunk' && (
        <ChunkEditor gridKey={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'streaming_volume' && (
        <StreamingVolumeEditor id={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'instance' && (
        <InstanceEditor id={selectedEntity.id} />
      )}
      {selectedEntity?.type === 'portal' && (
        <PortalEditor id={selectedEntity.id} />
      )}
    </div>
  );
}
