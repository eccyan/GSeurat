export interface CapturedError {
  component: string;
  message: string;
  timestamp: number;
}

export interface ComponentHealth {
  mounted: string[];
  expected: string[];
  missing: string[];
  unexpected: string[];
  errors: CapturedError[];
}

export interface ComponentManifest {
  always: string[];
  modes: Record<string, string[]>;
  conditional: Record<string, string>;
}

export class ComponentRegistry {
  private _mounted: Set<string> = new Set();
  private _errors: CapturedError[] = [];
  private _manifest: ComponentManifest | null = null;
  private _mode: string | null = null;

  mount(name: string): void {
    this._mounted.add(name);
  }

  unmount(name: string): void {
    this._mounted.delete(name);
  }

  reportError(component: string, message: string): void {
    this._errors.push({ component, message, timestamp: Date.now() });
  }

  setManifest(manifest: ComponentManifest): void {
    this._manifest = manifest;
  }

  setMode(mode: string): void {
    this._mode = mode;
  }

  health(): ComponentHealth {
    const mounted = Array.from(this._mounted);

    if (!this._manifest) {
      return {
        mounted,
        expected: [],
        missing: [],
        unexpected: mounted.slice(),
        errors: this._errors.slice(),
      };
    }

    const { always, modes, conditional } = this._manifest;
    const modeComponents = this._mode && modes[this._mode] ? modes[this._mode] : [];
    const expected = [...always, ...modeComponents];

    const conditionalKeys = new Set(Object.keys(conditional));

    const missing = expected.filter((c) => !this._mounted.has(c));
    const expectedSet = new Set(expected);
    const unexpected = mounted.filter(
      (c) => !expectedSet.has(c) && !conditionalKeys.has(c),
    );

    return {
      mounted,
      expected,
      missing,
      unexpected,
      errors: this._errors.slice(),
    };
  }

  reset(): void {
    this._mounted = new Set();
    this._errors = [];
    this._manifest = null;
    this._mode = null;
  }
}

export const componentRegistry = new ComponentRegistry();

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__COMPONENT_REGISTRY__'] =
    componentRegistry;
}
