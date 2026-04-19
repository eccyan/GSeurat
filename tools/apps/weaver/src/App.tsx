import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import {
  saveProjectRootHandle,
  restoreProjectRoot,
} from '@gseurat/project-root';
import {
  DebugDumpRegistry,
  installDebugDumpGlobal,
  installDebugDumpKeyboard,
} from '@gseurat/debug-dump';
import { useWeaverStore } from './store/useWeaverStore.js';
import { MenuBar } from './components/MenuBar.js';
import { TransportBar } from './components/TransportBar.js';
import { GroupPanel } from './components/GroupPanel.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';
import { EmptyProjectState } from './components/EmptyProjectState.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';
import { WeaverEarsDumper } from './lib/debugDumper.js';

export function App() {
  useAudioPlayer();

  // Debug dump: register ears dumper + install triggers (Ctrl+Shift+D / console)
  useEffect(() => {
    const registry = DebugDumpRegistry.getInstance();
    registry.setSource('weaver');
    const dumper = new WeaverEarsDumper();
    registry.register(dumper);
    installDebugDumpGlobal();
    installDebugDumpKeyboard();
    return () => { registry.unregister(dumper); };
  }, []);

  const projectRootHandle = useWeaverStore((s) => s.projectRootHandle);
  const setProjectRootHandle = useWeaverStore((s) => s.setProjectRootHandle);
  const projectName = useWeaverStore((s) => s.projectName);
  const groups = useWeaverStore((s) => s.groups);

  const [projectList, setProjectList] = useState<string[]>([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Restore project root on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await restoreProjectRoot('weaver');
        if (cancelled) return;
        if (handle) {
          setProjectRootHandle(handle);
        }
      } catch {
        console.info('[weaver] No project root to restore');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // List projects when root handle changes
  useEffect(() => {
    if (!projectRootHandle) return;
    (async () => {
      const list = await useWeaverStore.getState().listProjects();
      setProjectList(list);
      if (list.length === 1) {
        await useWeaverStore.getState().loadProject(list[0]);
      } else if (list.length > 1) {
        setShowProjectPicker(true);
      }
    })();
  }, [projectRootHandle]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        useWeaverStore.getState().saveProject();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        useWeaverStore.getState().redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        useWeaverStore.getState().undo();
      } else if (e.key === ' ') {
        e.preventDefault();
        const s = useWeaverStore.getState();
        s.setIsPlaying(!s.isPlaying);
      } else if (e.key === 'Home') {
        e.preventDefault();
        useWeaverStore.getState().setPlayheadFrame(0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Warn on tab close with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useWeaverStore.getState().dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleOpenProjectRoot = useCallback(async () => {
    try {
      const handle: FileSystemDirectoryHandle =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await saveProjectRootHandle('weaver', handle);
      setProjectRootHandle(handle);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.error('[weaver] Failed to set project root:', e);
      }
    }
  }, []);

  const handleNewProject = useCallback(() => {
    const name = prompt('Project name:');
    if (!name?.trim()) return;
    useWeaverStore.getState().newProject(name.trim());
  }, []);

  const handleOpenProject = useCallback(async (name: string) => {
    await useWeaverStore.getState().loadProject(name);
    setShowProjectPicker(false);
  }, []);

  // Empty state: no project root
  if (!projectRootHandle) {
    return (
      <EmptyProjectState
        hasProjectRoot={false}
        onOpenProjectRoot={handleOpenProjectRoot}
        onNewProject={handleNewProject}
      />
    );
  }

  // Empty state: show project picker
  if (showProjectPicker && projectName === 'untitled') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: 8,
          color: '#888',
        }}
      >
        <h2 style={{ color: '#77aaff' }}>Open Project</h2>
        {projectList.map((name) => (
          <button
            key={name}
            onClick={() => handleOpenProject(name)}
            style={{ padding: '8px 32px', minWidth: 200 }}
          >
            {name}
          </button>
        ))}
        <button
          onClick={handleNewProject}
          style={{ marginTop: 16, padding: '4px 16px', fontSize: 11, opacity: 0.7 }}
        >
          + New Project
        </button>
      </div>
    );
  }

  // Empty state: project root set but no projects
  if (projectName === 'untitled' && projectList.length === 0) {
    return (
      <EmptyProjectState
        hasProjectRoot={true}
        onOpenProjectRoot={handleOpenProjectRoot}
        onNewProject={handleNewProject}
      />
    );
  }

  return (
    <div className="weaver">
      <MenuBar />
      <TransportBar />
      <main className="weaver-body">
        <GroupPanel />
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
