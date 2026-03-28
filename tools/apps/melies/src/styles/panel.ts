import React from 'react';
import { T } from './theme.js';

export const panelStyles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  label: { fontSize: 10, color: T.textMuted, textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  input: { flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 },
  select: { flex: 1, padding: '3px 5px', fontSize: 12 },
  btn: {
    padding: '3px 8px', border: `1px solid ${T.borderLight}`, borderRadius: 4,
    background: T.surface, color: T.text, cursor: 'pointer', fontSize: 11,
  },
  btnDanger: {
    padding: '3px 8px', border: `1px solid ${T.danger}`, borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 11,
  },
  item: {
    padding: 8, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: T.accent },
  empty: { fontSize: 12, color: T.textMuted, textAlign: 'center' as const, paddingTop: 40 },
  checkbox: { marginRight: 4 },
};
