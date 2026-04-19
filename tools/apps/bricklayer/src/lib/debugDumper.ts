import type { EyesComponentNode, EyesWarning, IDebugDumpable } from '@gseurat/debug-dump';

/**
 * Bricklayer "eyes" domain dumper — gathers UI panel layout from the DOM.
 * Walks elements with `data-panel-id` attributes to build the component tree.
 * Zero cost until triggered via Ctrl+Shift+D or console.
 */
export class BricklayerEyesDumper implements IDebugDumpable {
  readonly debugDomain = 'eyes' as const;
  readonly debugName = 'BricklayerPanels';

  dumpDebugState(): EyesComponentNode[] {
    // Gather all panel elements from the DOM
    const panels = document.querySelectorAll<HTMLElement>('[data-panel-id]');
    return Array.from(panels).map((el) => walkElement(el, null));
  }
}

function walkElement(
  el: HTMLElement,
  parentBounds: { x: number; y: number; w: number; h: number } | null,
): EyesComponentNode {
  const rect = el.getBoundingClientRect();
  const globalBounds = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  const style = getComputedStyle(el);
  const warnings = detectWarnings(rect, parentBounds);

  const children: EyesComponentNode[] = [];
  const childPanels = el.querySelectorAll<HTMLElement>(':scope > [data-panel-id]');
  for (const child of childPanels) {
    children.push(walkElement(child, globalBounds));
  }

  return {
    id: el.dataset.panelId ?? el.id ?? 'unknown',
    type: el.tagName.toLowerCase(),
    class_name: el.className?.split?.(' ')?.[0] ?? '',
    layout: {
      local_bounds: {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: rect.width,
        h: rect.height,
      },
      global_bounds: globalBounds,
      z_index: parseInt(style.zIndex, 10) || 0,
    },
    state: {
      visible: style.display !== 'none' && style.visibility !== 'hidden',
      focused: document.activeElement === el || el.contains(document.activeElement),
      enabled: !el.hasAttribute('disabled'),
    },
    warnings,
    children,
  };
}

function detectWarnings(
  rect: DOMRect,
  parentBounds: { x: number; y: number; w: number; h: number } | null,
): EyesWarning[] {
  const warnings: EyesWarning[] = [];

  if (rect.width === 0 || rect.height === 0) {
    warnings.push('zero_size');
  }
  if (rect.x < 0 || rect.y < 0) {
    warnings.push('off_screen_negative');
  }
  if (parentBounds) {
    const fullyClipped =
      rect.x >= parentBounds.x + parentBounds.w ||
      rect.y >= parentBounds.y + parentBounds.h ||
      rect.x + rect.width <= parentBounds.x ||
      rect.y + rect.height <= parentBounds.y;
    if (fullyClipped) {
      warnings.push('clipped_by_parent');
    }
  }

  return warnings;
}
