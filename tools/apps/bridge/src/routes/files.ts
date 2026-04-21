import path from 'node:path';
import fs from 'node:fs/promises';
import { type Express, type Request, type Response } from 'express';
import { type ProjectContext } from '../context.js';
import { readBinaryBody } from '../helpers.js';

// Utility: ensure a path stays within the allowed base directory.
function safeResolve(base: string, name: string): string {
  const resolved = path.resolve(base, name);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal detected: ${name}`);
  }
  return resolved;
}

export function registerFileRoutes(app: Express, ctx: ProjectContext): void {
  // GET /api/files/scenes/:name — read a scene JSON file
  app.get('/api/files/scenes/:name', async (req: Request, res: Response) => {
    try {
      const filePath = safeResolve(ctx.getScenesDir(), `${req.params['name']}.json`);
      const content = await fs.readFile(filePath, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/files/scenes/:name — write a scene JSON file
  app.post('/api/files/scenes/:name', async (req: Request, res: Response) => {
    try {
      const filePath = safeResolve(ctx.getScenesDir(), `${req.params['name']}.json`);
      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
        await fs.writeFile(filePath, body, 'utf8');
      });
      console.log(`[REST] Scene written: ${filePath}`);
      res.json({ ok: true, path: filePath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });

  // GET /api/files/textures/:name — read a texture file as binary
  app.get('/api/files/textures/:name', async (req: Request, res: Response) => {
    try {
      const filePath = safeResolve(ctx.getTexturesDir(), req.params['name']);
      const data = await fs.readFile(filePath);
      // Detect content type from extension.
      const ext = path.extname(req.params['name']).toLowerCase();
      const mime = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.send(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 404;
      res.status(statusCode).json({ error: message });
    }
  });

  // POST /api/files/textures/:name — write a texture PNG (raw binary or base64)
  app.post('/api/files/textures/:name', async (req: Request, res: Response) => {
    try {
      const filePath = safeResolve(ctx.getTexturesDir(), req.params['name']);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const data = await readBinaryBody(req);

      await ctx.resourceLock.acquire(filePath, async () => {
        await fs.writeFile(filePath, data);
      });
      console.log(`[REST] Texture written: ${filePath} (${data.length} bytes)`);
      res.json({ ok: true, path: filePath, bytes: data.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const statusCode = message.includes('Path traversal') ? 400 : 500;
      res.status(statusCode).json({ error: message });
    }
  });
}
