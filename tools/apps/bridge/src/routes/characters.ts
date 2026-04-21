import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { type Express, type Request, type Response } from 'express';
import { type ProjectContext } from '../context.js';
import { readBinaryBody } from '../helpers.js';
import { exportPlyFromProject } from '../ply-export.js';
import type { EchidnaProject } from '../ply-export.js';

// Utility: ensure a path stays within the allowed base directory.
function safeResolve(base: string, name: string): string {
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected: ${name}`);
  }
  return resolved;
}

// Resolve a user-supplied path: expand ~ to home dir, resolve relative to home.
function resolveUserPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.resolve(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return path.resolve(p);
  // Relative paths resolve against home directory for predictability
  return path.resolve(os.homedir(), p);
}

// Allowed concept/chibi view directions
const VALID_VIEWS = ['front', 'back', 'right', 'left'];

// Allowed pipeline pass names
const VALID_PASSES = ['pending', 'pass1', 'pass1_edited', 'pass2', 'pass2_edited', 'pass3'];

export function registerCharacterRoutes(app: Express, ctx: ProjectContext): void {
  // GET /api/characters — list all character IDs with manifests
  app.get('/api/characters', async (_req: Request, res: Response) => {
    try {
      const charsDir = ctx.getCharactersDir();
      const entries = await fs.readdir(charsDir, { withFileTypes: true });
      const ids: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const mPath = path.join(charsDir, entry.name, 'manifest.json');
          try {
            await fs.access(mPath);
            ids.push(entry.name);
          } catch {
            // No manifest — skip
          }
        }
      }
      res.json({ characters: ids.sort() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/characters/:id — read a character manifest
  app.get('/api/characters/:id', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filePath = path.join(charDir, 'manifest.json');
      const content = await fs.readFile(filePath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/characters/:id — write/update a character manifest
  app.post('/api/characters/:id', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filePath = path.join(charDir, 'manifest.json');
      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.mkdir(charDir, { recursive: true });
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
        await fs.writeFile(filePath, body, 'utf8');
      });
      console.log(`[REST] Character manifest written: ${filePath}`);
      res.json({ ok: true, path: filePath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/characters/:id/rename — rename a character (change its ID)
  app.post('/api/characters/:id/rename', async (req: Request, res: Response) => {
    try {
      const oldId = req.params['id']!;
      const { newId } = req.body as { newId: string };
      if (!newId || !newId.match(/^[a-z0-9_]+$/)) {
        res.status(400).json({ error: 'newId must be lowercase alphanumeric with underscores' });
        return;
      }

      const result = await ctx.resourceLock.acquire(`character_manifest_${oldId}`, async () => {
        const charsDir = ctx.getCharactersDir();
        const oldDir = safeResolve(charsDir, oldId);
        const newDir = safeResolve(charsDir, newId);

        // Check old exists
        try { await fs.access(oldDir); } catch {
          return { error: `Character "${oldId}" not found`, status: 404 as number };
        }
        // Check new doesn't exist
        try { await fs.access(newDir); return { error: `Character "${newId}" already exists`, status: 409 as number }; } catch { /* good */ }

        // Rename directory
        await fs.rename(oldDir, newDir);

        // Update character_id in manifest
        const manifestPath = path.join(newDir, 'manifest.json');
        try {
          const raw = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(raw);
          manifest.character_id = newId;
          if (manifest.display_name === oldId) manifest.display_name = newId;
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        } catch { /* manifest update optional */ }

        return { ok: true };
      });

      if ('error' in result) {
        res.status(result.status as number).json({ error: result.error });
        return;
      }

      console.log(`[REST] Character renamed: ${oldId} → ${newId}`);
      res.json({ ok: true, oldId, newId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/characters/:id/concept-image/:view? — save concept art image
  // When :view is provided (front|back|right|left) → saves concept_{view}.png
  // When :view is omitted → saves concept.png
  app.post('/api/characters/:id/concept-image/:view', saveConceptImageHandler);
  app.post('/api/characters/:id/concept-image', saveConceptImageHandler);

  async function saveConceptImageHandler(req: Request, res: Response) {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const view = req.params['view'];
      if (view && !VALID_VIEWS.includes(view)) {
        res.status(400).json({ error: `Invalid view: ${view}` });
        return;
      }
      await fs.mkdir(charDir, { recursive: true });
      const filename = view ? `concept_${view}.png` : 'concept.png';
      const filePath = path.join(charDir, filename);
      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.writeFile(filePath, data);
      });
      console.log(`[REST] Concept image${view ? ` (${view})` : ''} written: ${filePath} (${data.length} bytes)`);
      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  }

  // GET /api/characters/:id/concept-image/:view? — serve concept art image
  // When :view is provided → serves concept_{view}.png
  // When :view is omitted → serves concept.png with fallback to concept_front.png
  app.get('/api/characters/:id/concept-image/:view', serveConceptImageHandler);
  app.get('/api/characters/:id/concept-image', serveConceptImageHandler);

  async function serveConceptImageHandler(req: Request, res: Response) {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const view = req.params['view'];
      if (view && !VALID_VIEWS.includes(view)) {
        res.status(400).json({ error: `Invalid view: ${view}` });
        return;
      }

      let data: Buffer | null = null;
      if (view) {
        data = await fs.readFile(path.join(charDir, `concept_${view}.png`));
      } else {
        // Backward compat: try concept.png first, then concept_front.png
        for (const filename of ['concept.png', 'concept_front.png']) {
          try {
            data = await fs.readFile(path.join(charDir, filename));
            break;
          } catch { /* try next */ }
        }
      }
      if (!data) throw new Error('No concept image found');
      res.setHeader('Content-Type', 'image/png');
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  }

  // POST /api/characters/:id/chibi-image/:view? — save chibi art image
  app.post('/api/characters/:id/chibi-image/:view', saveChibiImageHandler);
  app.post('/api/characters/:id/chibi-image', saveChibiImageHandler);

  async function saveChibiImageHandler(req: Request, res: Response) {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const view = req.params['view'];
      if (view && !VALID_VIEWS.includes(view)) {
        res.status(400).json({ error: `Invalid view: ${view}` });
        return;
      }
      await fs.mkdir(charDir, { recursive: true });
      const filename = view ? `chibi_${view}.png` : 'chibi.png';
      const filePath = path.join(charDir, filename);
      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.writeFile(filePath, data);
      });
      console.log(`[REST] Chibi image${view ? ` (${view})` : ''} written: ${filePath} (${data.length} bytes)`);
      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  }

  // GET /api/characters/:id/chibi-image/:view? — serve chibi art image
  app.get('/api/characters/:id/chibi-image/:view', serveChibiImageHandler);
  app.get('/api/characters/:id/chibi-image', serveChibiImageHandler);

  async function serveChibiImageHandler(req: Request, res: Response) {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const view = req.params['view'];
      if (view && !VALID_VIEWS.includes(view)) {
        res.status(400).json({ error: `Invalid view: ${view}` });
        return;
      }

      let data: Buffer | null = null;
      if (view) {
        data = await fs.readFile(path.join(charDir, `chibi_${view}.png`));
      } else {
        for (const filename of ['chibi.png', 'chibi_front.png']) {
          try {
            data = await fs.readFile(path.join(charDir, filename));
            break;
          } catch { /* try next */ }
        }
      }
      if (!data) throw new Error('No chibi image found');
      res.setHeader('Content-Type', 'image/png');
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  }

  // POST /api/characters/:id/pixel-image — save pixel art image (base64 PNG)
  app.post('/api/characters/:id/pixel-image', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      await fs.mkdir(charDir, { recursive: true });
      const filePath = path.join(charDir, 'pixel.png');

      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.writeFile(filePath, data);
      });
      console.log(`[REST] Pixel image written: ${filePath} (${data.length} bytes)`);
      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/characters/:id/pixel-image — serve pixel art image
  app.get('/api/characters/:id/pixel-image', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filePath = path.join(charDir, 'pixel.png');
      const data = await fs.readFile(filePath);
      res.setHeader('Content-Type', 'image/png');
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/characters/:id/file/:filename — save an arbitrary file to character directory
  // Accepts base64 JSON { "data": "<base64>" } or raw binary body.
  // Filename must end with .png, .json, or .ply for safety.
  app.post('/api/characters/:id/file/:filename', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filename = req.params['filename']!;
      // Whitelist safe extensions
      if (!/\.(png|json|ply)$/.test(filename)) {
        res.status(400).json({ error: `Unsupported file type: ${filename}` });
        return;
      }
      // Prevent path traversal in filename
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }
      await fs.mkdir(charDir, { recursive: true });
      const filePath = path.join(charDir, filename);
      const data = await readBinaryBody(req);
      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.writeFile(filePath, data);
      });
      console.log(`[REST] Character file written: ${filePath} (${data.length} bytes)`);
      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/characters/:id/file/:filename — serve an arbitrary file from character directory
  app.get('/api/characters/:id/file/:filename', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filename = req.params['filename']!;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }
      const filePath = path.join(charDir, filename);
      const data = await fs.readFile(filePath);
      const ext = filename.split('.').pop();
      if (ext === 'png') res.setHeader('Content-Type', 'image/png');
      else if (ext === 'json') res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/characters/:id/frames/:anim/:frame/image — save a frame PNG
  app.post('/api/characters/:id/frames/:anim/:frame/image', async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const charDir = safeResolve(ctx.getCharactersDir(), id);
      const animName = req.params['anim']!;
      const animDir = path.join(charDir, animName);
      const filename = `${animName}_${req.params['frame']}.png`;
      const filePath = path.join(animDir, filename);

      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(`character_manifest_${id}`, async () => {
        await fs.mkdir(animDir, { recursive: true });
        await fs.writeFile(filePath, data);
        console.log(`[REST] Frame image written: ${filePath} (${data.length} bytes)`);

        // Also update the manifest frame entry with the file path
        const manifestPath = path.join(charDir, 'manifest.json');
        try {
          const raw = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(raw);
          const anim = manifest.animations?.find((a: { name: string }) => a.name === animName);
          const frameIdx = parseInt(req.params['frame']!, 10);
          const frame = anim?.frames?.find((f: { index: number }) => f.index === frameIdx);
          if (frame) {
            frame.file = `${animName}/${filename}`;
            if (frame.status === 'pending') frame.status = 'generated';
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          }
        } catch { /* manifest update optional */ }
      });

      res.json({ ok: true, path: filePath, bytes: data.length, file: `${animName}/${filename}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/characters/:id/frames/:anim/:frame/image — serve a frame PNG
  app.get('/api/characters/:id/frames/:anim/:frame/image', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filename = `${req.params['anim']}_${req.params['frame']}.png`;
      const filePath = path.join(charDir, req.params['anim']!, filename);
      await fs.access(filePath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      const data = await fs.readFile(filePath);
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('no such file')) {
        res.status(404).json({ error: 'Frame image not found' });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // GET /api/characters/:id/frames/:anim/:frame/pass/:pass — serve an intermediate pass image
  app.get('/api/characters/:id/frames/:anim/:frame/pass/:pass', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const pass = req.params['pass']!;
      if (!VALID_PASSES.includes(pass)) {
        res.status(400).json({ error: `Invalid pass: ${pass}` });
        return;
      }
      const animName = req.params['anim']!;
      const frameIdx = req.params['frame']!;
      const filename = `${animName}_${frameIdx}_${pass}.png`;
      const filePath = path.join(charDir, animName, filename);
      await fs.access(filePath);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      const data = await fs.readFile(filePath);
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('no such file')) {
        res.status(404).json({ error: 'Pass image not found' });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // POST /api/characters/:id/frames/:anim/:frame/pass/:pass — save an intermediate pass image
  app.post('/api/characters/:id/frames/:anim/:frame/pass/:pass', async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const charDir = safeResolve(ctx.getCharactersDir(), id);
      const pass = req.params['pass']!;
      if (!VALID_PASSES.includes(pass)) {
        res.status(400).json({ error: `Invalid pass: ${pass}` });
        return;
      }
      const animName = req.params['anim']!;
      const animDir = path.join(charDir, animName);
      const frameIdx = req.params['frame']!;
      const filename = `${animName}_${frameIdx}_${pass}.png`;
      const filePath = path.join(animDir, filename);

      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(`character_manifest_${id}`, async () => {
        await fs.mkdir(animDir, { recursive: true });
        await fs.writeFile(filePath, data);
        console.log(`[REST] Pass image written: ${filePath} (${data.length} bytes)`);

        // Update pipeline_stage in manifest
        const manifestPath = path.join(charDir, 'manifest.json');
        try {
          const raw = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(raw);
          const anim = manifest.animations?.find((a: { name: string }) => a.name === animName);
          const fi = parseInt(frameIdx, 10);
          const frame = anim?.frames?.find((f: { index: number }) => f.index === fi);
          if (frame) {
            frame.pipeline_stage = pass;
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          }
        } catch { /* manifest update optional */ }
      });

      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // DELETE /api/characters/:id/frames/:anim/:frame/pass/:pass — delete a pass image
  app.delete('/api/characters/:id/frames/:anim/:frame/pass/:pass', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const pass = req.params['pass']!;
      if (!VALID_PASSES.includes(pass)) {
        res.status(400).json({ error: `Invalid pass: ${pass}` });
        return;
      }
      const animName = req.params['anim']!;
      const frameIdx = req.params['frame']!;
      const filename = `${animName}_${frameIdx}_${pass}.png`;
      const filePath = path.join(charDir, animName, filename);
      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.unlink(filePath);
      });
      console.log(`[REST] Pass image deleted: ${filePath}`);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('ENOENT') ? 404 : 500).json({ error: message });
    }
  });

  // GET /api/characters/:id/frames/:anim/:frame — get a specific frame's status
  app.get('/api/characters/:id/frames/:anim/:frame', async (req: Request, res: Response) => {
    try {
      const charDir = safeResolve(ctx.getCharactersDir(), req.params['id']!);
      const filePath = path.join(charDir, 'manifest.json');
      const content = await fs.readFile(filePath, 'utf8');
      const manifest = JSON.parse(content);
      const anim = manifest.animations?.find((a: { name: string }) => a.name === req.params['anim']);
      if (!anim) {
        res.status(404).json({ error: `Animation "${req.params['anim']}" not found` });
        return;
      }
      const frameIdx = parseInt(req.params['frame']!, 10);
      const frame = anim.frames?.find((f: { index: number }) => f.index === frameIdx);
      if (!frame) {
        res.status(404).json({ error: `Frame ${frameIdx} not found` });
        return;
      }
      res.json(frame);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  // POST /api/characters/:id/frames/:anim/:frame — update a frame's status
  app.post('/api/characters/:id/frames/:anim/:frame', async (req: Request, res: Response) => {
    try {
      const id = req.params['id']!;
      const charDir = safeResolve(ctx.getCharactersDir(), id);
      const animName = req.params['anim']!;
      const frameIdx = parseInt(req.params['frame']!, 10);

      const result = await ctx.resourceLock.acquire(`character_manifest_${id}`, async () => {
        const filePath = path.join(charDir, 'manifest.json');
        const content = await fs.readFile(filePath, 'utf8');
        const manifest = JSON.parse(content);
        const anim = manifest.animations?.find((a: { name: string }) => a.name === animName);
        if (!anim) {
          return { error: `Animation "${animName}" not found`, status: 404 as number };
        }
        const frame = anim.frames?.find((f: { index: number }) => f.index === frameIdx);
        if (!frame) {
          return { error: `Frame ${frameIdx} not found`, status: 404 as number };
        }

        // Update frame fields from request body
        if (req.body.status) frame.status = req.body.status;
        if (req.body.source) frame.source = req.body.source;
        if (req.body.file) frame.file = req.body.file;
        if (req.body.generation) frame.generation = req.body.generation;
        if (req.body.review) frame.review = req.body.review;
        if (req.body.notes !== undefined) {
          if (!frame.review) frame.review = { reviewer: 'human', notes: '' };
          frame.review.notes = req.body.notes;
        }

        await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
        console.log(`[REST] Frame updated: ${id}/${animName}[${frameIdx}]`);
        return { ok: true, frame };
      });

      if ('error' in result) {
        res.status(result.status as number).json({ error: result.error });
        return;
      }

      res.json({ ok: true, frame: result.frame });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/characters/:id/assemble — trigger atlas assembly
  app.post('/api/characters/:id/assemble', async (req: Request, res: Response) => {
    try {
      // Dynamically import the atlas assembler (optional dependency)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (import('@gseurat/atlas-assembler' as any) as Promise<any>);
      const validate = req.body?.validate === true;
      const result = await mod.assembleCharacterAtlas(req.params['id']!, { validate });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/characters/:name/export-ply — export Echidna project as PLY binary
  // Body: { echidnaProject: EchidnaProject, outputPath?: string }
  // If outputPath is provided, writes the PLY to that path and returns JSON metadata.
  // Otherwise returns the raw PLY binary with Content-Type: application/octet-stream.
  app.post('/api/characters/:name/export-ply', async (req: Request, res: Response) => {
    try {
      const { echidnaProject, outputPath } = req.body as {
        echidnaProject?: EchidnaProject;
        outputPath?: string;
      };

      if (!echidnaProject) {
        res.status(400).json({ error: 'echidnaProject is required in request body' });
        return;
      }

      const plyBuffer = exportPlyFromProject(echidnaProject);

      if (outputPath) {
        // Write to the specified filesystem path
        const resolved = resolveUserPath(outputPath);
        await ctx.resourceLock.acquire(resolved, async () => {
          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, plyBuffer);
        });
        console.log(`[REST] PLY exported: ${resolved} (${plyBuffer.length} bytes)`);
        res.json({ success: true, path: resolved, size: plyBuffer.length });
      } else {
        // Return raw binary
        const charName = req.params['name'] ?? 'character';
        const safeName = charName.replace(/[^a-zA-Z0-9_-]/g, '_');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}.ply"`);
        res.send(plyBuffer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}
