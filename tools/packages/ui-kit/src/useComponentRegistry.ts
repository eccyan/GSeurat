import { useEffect } from 'react';
import { componentRegistry } from './ComponentRegistry.js';

export function useComponentRegistry(name: string): void {
  useEffect(() => {
    componentRegistry.mount(name);
    return () => {
      componentRegistry.unmount(name);
    };
  }, [name]);
}
