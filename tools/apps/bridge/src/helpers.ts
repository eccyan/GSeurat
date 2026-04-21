import { type Request } from 'express';

export async function readBinaryBody(req: Request): Promise<Buffer> {
  const contentType = req.headers['content-type'] ?? '';
  if (contentType.includes('application/json') && req.body && typeof req.body['data'] === 'string') {
    return Buffer.from(req.body['data'] as string, 'base64');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
