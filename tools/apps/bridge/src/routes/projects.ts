import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { type Express, type Request, type Response } from 'express';
import { type ProjectContext } from '../context.js';
import { type WSServer } from '../ws-server.js';
import { type UnixSocketClient } from '../unix-client.js';
import { type RequestTracker } from '../request-tracker.js';

// Resolve a user-supplied path: expand ~ to home dir, resolve relative to home.
function resolveUserPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.resolve(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return path.resolve(p);
  // Relative paths resolve against home directory for predictability
  return path.resolve(os.homedir(), p);
}

export function registerProjectRoutes(
  app: Express,
  ctx: ProjectContext,
  forwardToEngine: (payload: Record<string, unknown>) => void,
  wsServer: WSServer,
  unixClient: UnixSocketClient,
  tracker: RequestTracker,
): void {
  // POST /api/project/root — set the active project root directory
  // All asset endpoints (/api/files/scenes/*, /api/files/textures/*, /api/characters/*)
  // will resolve under this root until changed or the bridge restarts.
  app.post('/api/project/root', async (req: Request, res: Response) => {
    const { path: projectPath } = req.body as { path?: string };
    if (typeof projectPath !== 'string' || projectPath.length === 0) {
      res.status(400).json({ error: 'path required' });
      return;
    }
    try {
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'not a directory' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'directory does not exist' });
      return;
    }
    ctx.activeProjectDir = path.resolve(projectPath);
    console.log(`[Bridge] Project root set: ${ctx.activeProjectDir}`);

    // Forward to engine over the Unix socket so the engine can resolve
    // relative paths under this same root. Engine-side handler lands in Task 28.
    forwardToEngine({ cmd: 'set_project_root', path: ctx.activeProjectDir });

    res.status(200).json({ ok: true, activeProjectDir: ctx.activeProjectDir });
  });

  // POST /api/projects/create — create a new project directory
  app.post('/api/projects/create', async (req: Request, res: Response) => {
    try {
      const { path: dirPath, name } = req.body as { path: string; name: string };
      if (!dirPath || !name) {
        res.status(400).json({ error: 'path and name are required' });
        return;
      }
      const projectDir = resolveUserPath(dirPath);

      const project = await ctx.resourceLock.acquire(projectDir, async () => {
        const charsDir = path.join(projectDir, 'characters');
        await fs.mkdir(charsDir, { recursive: true });

        const proj = {
          version: 1,
          name,
          created_at: new Date().toISOString(),
          modified_at: new Date().toISOString(),
          characters: [] as string[],
          ai_config: null,
          export_presets: {
            default: { format: 'spritesheet', include_characters: [], output_dir: 'export' },
          },
        };
        await fs.writeFile(path.join(projectDir, 'project.json'), JSON.stringify(proj, null, 2), 'utf8');
        return proj;
      });

      ctx.activeProjectDir = projectDir;
      console.log(`[Bridge] Project created: ${projectDir}`);
      res.json({ ok: true, project });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/projects/open — open an existing project
  app.post('/api/projects/open', async (req: Request, res: Response) => {
    try {
      const { path: dirPath } = req.body as { path: string };
      if (!dirPath) {
        res.status(400).json({ error: 'path is required' });
        return;
      }
      const projectDir = resolveUserPath(dirPath);
      const projectFile = path.join(projectDir, 'project.json');
      const content = await fs.readFile(projectFile, 'utf8');
      const project = JSON.parse(content);

      ctx.activeProjectDir = projectDir;
      console.log(`[Bridge] Project opened: ${projectDir}`);
      res.json({ ok: true, project, path: projectDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('ENOENT') ? 404 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/projects/current — get current project meta
  app.get('/api/projects/current', async (_req: Request, res: Response) => {
    if (!ctx.activeProjectDir) {
      res.json({ project: null, path: null });
      return;
    }
    try {
      const projectFile = path.join(ctx.activeProjectDir, 'project.json');
      const content = await fs.readFile(projectFile, 'utf8');
      const project = JSON.parse(content);
      res.json({ project, path: ctx.activeProjectDir });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/projects/save — save project metadata
  app.post('/api/projects/save', async (req: Request, res: Response) => {
    try {
      if (!ctx.activeProjectDir) {
        res.status(400).json({ error: 'No active project' });
        return;
      }
      const { project } = req.body as { project: Record<string, unknown> };
      if (!project) {
        res.status(400).json({ error: 'project body is required' });
        return;
      }
      project.modified_at = new Date().toISOString();
      const projectFile = path.join(ctx.activeProjectDir, 'project.json');
      await ctx.resourceLock.acquire(projectFile, async () => {
        await fs.writeFile(projectFile, JSON.stringify(project, null, 2), 'utf8');
      });
      console.log(`[Bridge] Project saved: ${projectFile}`);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/projects/close — close active project
  app.post('/api/projects/close', (_req: Request, res: Response) => {
    console.log(`[Bridge] Project closed: ${ctx.activeProjectDir}`);
    ctx.activeProjectDir = null;
    res.json({ ok: true });
  });

  // POST /api/projects/export — export characters
  app.post('/api/projects/export', async (req: Request, res: Response) => {
    try {
      if (!ctx.activeProjectDir) {
        res.status(400).json({ error: 'No active project' });
        return;
      }
      const {
        characterIds,
        format = 'spritesheet',
        outputDir,
      } = req.body as { characterIds?: string[]; format?: string; outputDir?: string };

      // Dynamically import the export function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (import('@gseurat/atlas-assembler' as any) as Promise<any>);
      const exportFn = mod.exportCharacters;
      if (typeof exportFn !== 'function') {
        res.status(500).json({ error: 'Export function not available — update atlas-assembler' });
        return;
      }

      const charsDir = ctx.getCharactersDir();
      const exportDir = outputDir
        ? path.resolve(ctx.activeProjectDir, outputDir)
        : path.join(ctx.activeProjectDir, 'export');

      // If no characterIds specified, list all characters
      let ids = characterIds;
      if (!ids || ids.length === 0) {
        const entries = await fs.readdir(charsDir, { withFileTypes: true });
        ids = [];
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const mPath = path.join(charsDir, entry.name, 'manifest.json');
            try { await fs.access(mPath); ids.push(entry.name); } catch { /* skip */ }
          }
        }
      }

      const results = await exportFn(ids, {
        charactersDir: charsDir,
        outputDir: exportDir,
        format: format as 'spritesheet' | 'individual',
      });

      res.json({ ok: true, results });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/tools — list registered tool clients
  app.get('/api/tools', (_req: Request, res: Response) => {
    res.json({ tools: wsServer.getToolList() });
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      engineConnected: unixClient.isConnected,
      wsClients: wsServer.clientCount,
      pendingRequests: tracker.pendingCount,
      tools: wsServer.getToolList(),
    });
  });
}
