/**
 * Shared WASM simulation module loader.
 *
 * Ensures @gseurat/simulation-wasm is loaded at most once across all
 * components that need it. Returns the module instance or null on failure.
 */

let wasmModule: any = null;
let wasmLoading = false;

export async function loadSimulationWasm(): Promise<any> {
  if (wasmModule) return wasmModule;
  if (wasmLoading) {
    // Wait for in-progress load to finish
    while (wasmLoading) await new Promise((r) => setTimeout(r, 50));
    return wasmModule;
  }
  wasmLoading = true;
  try {
    const createModule = (await import('@gseurat/simulation-wasm')).default;
    wasmModule = await createModule();
  } catch (e) {
    console.warn('[simulation-wasm] WASM not available:', e);
  }
  wasmLoading = false;
  return wasmModule;
}
