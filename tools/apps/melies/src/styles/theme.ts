import type { ElementType } from '../store/types.js';
type LayerType = ElementType;

// ── Shared theme — single source of truth for Méliès UI ──

export const T = {
  bg: '#0f0f1e',
  panel: '#161628',
  panelAlt: '#1c1c34',
  surface: '#22223a',
  border: '#2a2a44',
  borderLight: '#3a3a5a',
  text: '#c8c8d8',
  textDim: '#7878a0',
  textMuted: '#50506a',
  accent: '#6366f1',
  accentDim: '#4f46e5',
  danger: '#ef4444',
  // Phase colors
  phaseAnticipation: '#f59e0b',
  phaseImpact: '#ef4444',
  phaseResidual: '#3b82f6',
  // Layer type colors
  layerEmitter: '#ec4899',
  layerAnimation: '#06b6d4',
  layerLight: '#eab308',
};

export const inputStyle: React.CSSProperties = {
  padding: '4px 8px', background: T.surface, border: `1px solid ${T.border}`,
  borderRadius: 4, color: T.text, fontSize: 12, outline: 'none', width: '100%',
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: 'pointer', appearance: 'none' as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%237878a0'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', paddingRight: 24,
};

export const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: T.textMuted, textTransform: 'uppercase', letterSpacing: 1,
  display: 'block', marginBottom: 4,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 12, color: T.textDim, userSelect: 'none', cursor: 'ew-resize',
};

export const layerColor = (type: LayerType) =>
  type === 'object' ? T.textDim
    : type === 'emitter' ? T.layerEmitter
    : type === 'animation' ? T.layerAnimation
    : T.layerLight;

