import { useRef, useCallback } from 'react';
import { useEditorStore } from '../store/useEditorStore.js';
import type {
  SceneResponse,
  TilemapResponse,
  OkResponse,
  LightParams,
} from '@gseurat/engine-client';

// Re-export the EngineClient interface shape so callers can reference it if
// needed, while keeping the actual import lazy (dynamic import at connect time)
// to survive when the workspace package is not yet built/installed.
interface EngineClientLike {
  connect(): Promise<void>;
  disconnect(): void;
  send<T>(cmd: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (data: unknown) => void): () => void;
  readonly isConnected: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the EngineClient WebSocket connection and exposes typed helper
 * methods for every level-designer command.
 *
 * The underlying client is stored in a ref so reconnects / disconnects never
 * trigger React re-renders. Connection state is surfaced through the Zustand
 * editor store (`connected` / `setConnected`).
 *
 * Usage:
 *   const engine = useEngine();
 *   await engine.connect();
 *   const tilemap = await engine.getTilemap();
 */
export function useEngine() {
  const clientRef = useRef<EngineClientLike | null>(null);
  const setConnected = useEditorStore((s) => s.setConnected);

  // -------------------------------------------------------------------------
  // Connection management
  // -------------------------------------------------------------------------

  /**
   * Dynamically imports EngineClient and opens a WebSocket to the bridge.
   * Safe to call multiple times — if already connected it is a no-op.
   */
  const connect = useCallback(async (): Promise<void> => {
    if (clientRef.current?.isConnected) return;

    try {
      const mod = await import('@gseurat/engine-client');
      const client = new mod.EngineClient('ws://localhost:9100') as EngineClientLike;
      await client.connect();
      clientRef.current = client;
      setConnected(true);
    } catch (err) {
      console.warn('[useEngine] Failed to connect to engine bridge:', err);
      clientRef.current = null;
      setConnected(false);
    }
  }, [setConnected]);

  /**
   * Closes the WebSocket and clears the client ref.
   */
  const disconnect = useCallback((): void => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
  }, [setConnected]);

  // -------------------------------------------------------------------------
  // Low-level send helper
  // -------------------------------------------------------------------------

  /**
   * Sends any command object to the engine and returns the typed response.
   * Returns `null` when not connected or when the command throws.
   */
  const sendCommand = useCallback(
    async <T,>(cmd: Record<string, unknown>): Promise<T | null> => {
      if (!clientRef.current?.isConnected) {
        console.warn('[useEngine] sendCommand called while not connected:', cmd);
        return null;
      }
      try {
        return await clientRef.current.send<T>(cmd);
      } catch (err) {
        console.error('[useEngine] Engine command failed:', cmd, err);
        return null;
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Event subscription helper
  // -------------------------------------------------------------------------

  /**
   * Subscribe to an engine event. Returns an unsubscribe function.
   * If the client is not connected the handler is never called and a no-op
   * unsubscribe is returned.
   */
  const onEvent = useCallback(
    (event: string, handler: (data: unknown) => void): (() => void) => {
      if (!clientRef.current) return () => {};
      return clientRef.current.on(event, handler);
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Scene read commands
  // -------------------------------------------------------------------------

  /** Fetch the current scene metadata (ambient, lights, portals, weather…). */
  const getScene = useCallback(
    (): Promise<SceneResponse | null> =>
      sendCommand<SceneResponse>({ cmd: 'get_scene' }),
    [sendCommand],
  );

  /** Fetch the current tilemap grid (tile IDs, solidity, animations…). */
  const getTilemap = useCallback(
    (): Promise<TilemapResponse | null> =>
      sendCommand<TilemapResponse>({ cmd: 'get_tilemap' }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Tile painting commands
  // -------------------------------------------------------------------------

  /**
   * Set a single tile in the running engine tilemap.
   *
   * @param col     Zero-based column index.
   * @param row     Zero-based row index.
   * @param tileId  Tile ID from the tileset (0 = floor, 1 = wall, etc.).
   * @param solid   Whether the tile blocks movement.
   */
  const setTile = useCallback(
    (
      col: number,
      row: number,
      tileId: number,
      solid: boolean,
    ): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_tile', col, row, tile_id: tileId, solid }),
    [sendCommand],
  );

  /**
   * Set multiple tiles in one round-trip.
   *
   * @param tiles  Array of `{ col, row, tile_id, solid }` entries.
   */
  const setTiles = useCallback(
    (
      tiles: Array<{ col: number; row: number; tile_id: number; solid?: boolean }>,
    ): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_tiles', tiles }),
    [sendCommand],
  );

  /**
   * Resize the tilemap in the running engine, optionally filling new cells.
   *
   * @param cols        New column count.
   * @param rows        New row count.
   * @param fillTileId  Tile ID to use for newly created cells (default 0).
   */
  const resizeTilemap = useCallback(
    (cols: number, rows: number, fillTileId = 0): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'resize_tilemap', cols, rows, fill_tile_id: fillTileId }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Ambient / environment
  // -------------------------------------------------------------------------

  /**
   * Update the scene ambient light color.
   *
   * @param r        Red channel [0, 1].
   * @param g        Green channel [0, 1].
   * @param b        Blue channel [0, 1].
   * @param strength Optional strength multiplier (default 1.0).
   */
  const setAmbient = useCallback(
    (r: number, g: number, b: number, strength?: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({
        cmd: 'set_ambient',
        r,
        g,
        b,
        ...(strength !== undefined && { strength }),
      }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Static light management
  // -------------------------------------------------------------------------

  /**
   * Add a new static point light to the scene.
   *
   * @param light  Light parameters (position, radius, color, intensity, height).
   */
  const addLight = useCallback(
    (light: LightParams): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'add_light', light }),
    [sendCommand],
  );

  /**
   * Remove the static light at the given index.
   */
  const removeLight = useCallback(
    (index: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'remove_light', index }),
    [sendCommand],
  );

  /**
   * Update individual fields of an existing static light.
   *
   * @param index  Zero-based index into the scene's lights array.
   * @param light  Partial light parameters to merge.
   */
  const updateLight = useCallback(
    (index: number, light: Partial<LightParams>): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'update_light', index, light }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Player / camera
  // -------------------------------------------------------------------------

  /**
   * Teleport the player to the given world-space position.
   *
   * @param x  World X coordinate.
   * @param y  World Y coordinate.
   */
  const setPlayerPosition = useCallback(
    (x: number, y: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_player_position', x, y }),
    [sendCommand],
  );

  /**
   * Move / aim the camera at a target position in world space.
   *
   * @param targetX      World X for the camera follow target.
   * @param targetY      World Y for the camera follow target.
   * @param zoom         Optional zoom level (default preserves current zoom).
   * @param followSpeed  Optional lerp speed override.
   */
  const setCamera = useCallback(
    (
      targetX: number,
      targetY: number,
      zoom?: number,
      followSpeed?: number,
    ): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({
        cmd: 'set_camera',
        target_x: targetX,
        target_y: targetY,
        ...(zoom !== undefined && { zoom }),
        ...(followSpeed !== undefined && { follow_speed: followSpeed }),
      }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Scene lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reload the current scene from disk, discarding any in-memory edits made
   * through the editor socket commands.
   */
  const reloadScene = useCallback(
    (): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'reload_scene' }),
    [sendCommand],
  );

  /**
   * Load a scene from a raw JSON string without touching the filesystem.
   * Useful for applying editor state to the running engine.
   *
   * @param json  Serialized scene JSON.
   */
  const loadSceneJson = useCallback(
    (json: string): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'load_scene_json', json }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Portal management
  // -------------------------------------------------------------------------

  /**
   * Add a portal (scene transition trigger) to the map.
   */
  const addPortal = useCallback(
    (portal: {
      x: number;
      y: number;
      width: number;
      height: number;
      target_scene: string;
      spawn_x: number;
      spawn_y: number;
      spawn_facing?: string;
    }): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'add_portal', portal }),
    [sendCommand],
  );

  /**
   * Remove the portal at the given index.
   */
  const removePortal = useCallback(
    (index: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'remove_portal', index }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Weather / day-night
  // -------------------------------------------------------------------------

  /**
   * Set the weather type and optional intensity.
   *
   * @param type       'clear' | 'rain' | 'snow'
   * @param intensity  0.0 – 1.0 (default preserves current intensity).
   */
  const setWeather = useCallback(
    (type: 'clear' | 'rain' | 'snow', intensity?: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({
        cmd: 'set_weather',
        type,
        ...(intensity !== undefined && { intensity }),
      }),
    [sendCommand],
  );

  /**
   * Configure the day/night cycle.
   *
   * @param enabled     Enable or disable the cycle.
   * @param cycleSpeed  World-time units per real second (optional).
   * @param timeOfDay   Jump to a specific time [0, 1) (optional).
   */
  const setDayNight = useCallback(
    (enabled: boolean, cycleSpeed?: number, timeOfDay?: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({
        cmd: 'set_day_night',
        enabled,
        ...(cycleSpeed !== undefined && { cycle_speed: cycleSpeed }),
        ...(timeOfDay !== undefined && { time_of_day: timeOfDay }),
      }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Feature flags
  // -------------------------------------------------------------------------

  /**
   * Enable or disable a named engine feature flag (e.g. 'bloom', 'fog').
   */
  const setFeature = useCallback(
    (feature: string, enabled: boolean): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'set_feature', feature, enabled }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Screen effects
  // -------------------------------------------------------------------------

  /**
   * Trigger a camera shake effect.
   */
  const shake = useCallback(
    (amplitude: number, frequency: number, duration: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'shake', amplitude, frequency, duration }),
    [sendCommand],
  );

  /**
   * Trigger a full-screen color flash overlay.
   */
  const flash = useCallback(
    (r: number, g: number, b: number, a: number, duration: number): Promise<OkResponse | null> =>
      sendCommand<OkResponse>({ cmd: 'flash', r, g, b, a, duration }),
    [sendCommand],
  );

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // Connection
    connect,
    disconnect,
    /** True when the underlying WebSocket is in the OPEN state. */
    isConnected: (): boolean => clientRef.current?.isConnected ?? false,

    // Generic escape hatch
    sendCommand,
    onEvent,

    // Scene
    getScene,
    getTilemap,
    reloadScene,
    loadSceneJson,

    // Tiles
    setTile,
    setTiles,
    resizeTilemap,

    // Ambient
    setAmbient,

    // Lights
    addLight,
    removeLight,
    updateLight,

    // Player / camera
    setPlayerPosition,
    setCamera,

    // Portals
    addPortal,
    removePortal,

    // Environment
    setWeather,
    setDayNight,

    // Feature flags
    setFeature,

    // Screen effects
    shake,
    flash,
  };
}
