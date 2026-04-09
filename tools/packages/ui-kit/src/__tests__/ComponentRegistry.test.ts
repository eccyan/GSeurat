import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry, componentRegistry } from '../ComponentRegistry';

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  describe('mount/unmount', () => {
    it('tracks mounted components', () => {
      registry.mount('Toolbar');
      registry.mount('Sidebar');
      const health = registry.health();
      expect(health.mounted).toContain('Toolbar');
      expect(health.mounted).toContain('Sidebar');
    });

    it('removes unmounted components', () => {
      registry.mount('Toolbar');
      registry.mount('Sidebar');
      registry.unmount('Toolbar');
      const health = registry.health();
      expect(health.mounted).not.toContain('Toolbar');
      expect(health.mounted).toContain('Sidebar');
    });

    it('handles duplicate mount gracefully', () => {
      registry.mount('Toolbar');
      registry.mount('Toolbar');
      const health = registry.health();
      expect(health.mounted.filter((c) => c === 'Toolbar').length).toBe(1);
    });

    it('handles unmount of non-mounted component gracefully', () => {
      expect(() => registry.unmount('NonExistent')).not.toThrow();
      const health = registry.health();
      expect(health.mounted).not.toContain('NonExistent');
    });
  });

  describe('manifest and health reporting', () => {
    beforeEach(() => {
      registry.setManifest({
        always: ['Toolbar', 'Sidebar'],
        modes: {
          terrain: ['TerrainPanel'],
          scene: ['ScenePanel'],
        },
        conditional: {
          DebugOverlay: 'debugMode',
        },
      });
    });

    it('reports missing components from manifest (expected but not mounted)', () => {
      registry.setMode('terrain');
      // Mount only some expected components
      registry.mount('Toolbar');
      const health = registry.health();
      expect(health.missing).toContain('Sidebar');
      expect(health.missing).toContain('TerrainPanel');
      expect(health.missing).not.toContain('Toolbar');
    });

    it('reports unexpected components (mounted but not in manifest)', () => {
      registry.setMode('terrain');
      registry.mount('Toolbar');
      registry.mount('Sidebar');
      registry.mount('TerrainPanel');
      registry.mount('UnknownWidget'); // not in manifest
      const health = registry.health();
      expect(health.unexpected).toContain('UnknownWidget');
      expect(health.unexpected).not.toContain('Toolbar');
    });

    it('conditional components are excluded from missing', () => {
      registry.setMode('terrain');
      registry.mount('Toolbar');
      registry.mount('Sidebar');
      registry.mount('TerrainPanel');
      // DebugOverlay is conditional — should NOT appear in missing
      const health = registry.health();
      expect(health.missing).not.toContain('DebugOverlay');
    });

    it('includes mode-specific components in expected', () => {
      registry.setMode('scene');
      const health = registry.health();
      expect(health.expected).toContain('Toolbar');
      expect(health.expected).toContain('Sidebar');
      expect(health.expected).toContain('ScenePanel');
      expect(health.expected).not.toContain('TerrainPanel');
    });

    it('expected is always-only when no mode set', () => {
      // No setMode called
      const health = registry.health();
      expect(health.expected).toContain('Toolbar');
      expect(health.expected).toContain('Sidebar');
      expect(health.expected).not.toContain('TerrainPanel');
      expect(health.expected).not.toContain('ScenePanel');
    });

    it('expected is empty when no manifest set', () => {
      const emptyRegistry = new ComponentRegistry();
      const health = emptyRegistry.health();
      expect(health.expected).toEqual([]);
      expect(health.missing).toEqual([]);
    });
  });

  describe('reportError', () => {
    it('tracks errors via reportError', () => {
      registry.reportError('Toolbar', new Error('Something went wrong'));
      const health = registry.health();
      expect(health.errors).toHaveLength(1);
      expect(health.errors[0].component).toBe('Toolbar');
      expect(health.errors[0].message).toBe('Something went wrong');
      expect(typeof health.errors[0].timestamp).toBe('number');
    });

    it('accumulates multiple errors', () => {
      registry.reportError('Toolbar', new Error('Error 1'));
      registry.reportError('Sidebar', new Error('Error 2'));
      const health = registry.health();
      expect(health.errors).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('reset clears all state', () => {
      registry.setManifest({
        always: ['Toolbar'],
        modes: {},
        conditional: {},
      });
      registry.setMode('terrain');
      registry.mount('Toolbar');
      registry.mount('Sidebar');
      registry.reportError('Toolbar', new Error('err'));
      registry.reset();
      const health = registry.health();
      expect(health.mounted).toEqual([]);
      expect(health.expected).toEqual([]);
      expect(health.missing).toEqual([]);
      expect(health.unexpected).toEqual([]);
      expect(health.errors).toEqual([]);
    });
  });

  describe('singleton', () => {
    afterEach(() => componentRegistry.reset());

    it('exports a singleton componentRegistry', () => {
      expect(componentRegistry).toBeInstanceOf(ComponentRegistry);
    });

    it('singleton is the same instance across imports', async () => {
      const { componentRegistry: reg2 } = await import('../ComponentRegistry');
      expect(componentRegistry).toBe(reg2);
    });
  });
});
