import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import {
  saveProjectRootHandle,
  restoreProjectRoot,
} from '@gseurat/project-root';
import { useWeaverStore } from './store/useWeaverStore.js';
import { Toolbar } from './components/Toolbar.js';
import { TimelinePanel } from './components/TimelinePanel.js';
import { Sidebar } from './components/Sidebar.js';
import { EmptyProjectState } from './components/EmptyProjectState.js';
import { useAudioPlayer } from './hooks/useAudioPlayer.js';

export function App() {
  useAudioPlayer();

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

  // Cmd+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        useWeaverStore.getState().saveProject();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleOpenProjectRoot = useCallback(async () => {
    try {
      // @ts-expect-error showDirectoryPicker is FSAPI extension
      const handle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker({ mode: 'readwrite' });
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
      <Toolbar />
      <main className="weaver-body">
        <TimelinePanel />
        <Sidebar />
      </main>
    </div>
  );
}
