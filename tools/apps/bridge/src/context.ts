import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncResourceLock } from './utils/AsyncResourceLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR_FALLBACK = path.resolve(__dirname, '../../../../');

export class ProjectContext {
  activeProjectDir: string | null = null;
  readonly resourceLock = new AsyncResourceLock();

  getScenesDir(): string {
    return this.activeProjectDir
      ? path.join(this.activeProjectDir, 'assets', 'scenes')
      : path.join(ENGINE_DIR_FALLBACK, 'assets', 'scenes');
  }

  getTexturesDir(): string {
    return this.activeProjectDir
      ? path.join(this.activeProjectDir, 'assets', 'textures')
      : path.join(ENGINE_DIR_FALLBACK, 'assets', 'textures');
  }

  getCharactersDir(): string {
    return this.activeProjectDir
      ? path.join(this.activeProjectDir, 'assets', 'characters')
      : path.join(ENGINE_DIR_FALLBACK, 'assets', 'characters');
  }
}
