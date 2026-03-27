import React from 'react';

export const panelStyles: Record<string, React.CSSProperties> = {
  section: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 },
  label: { fontSize: 11, color: '#888', textTransform: 'uppercase' as const, letterSpacing: 1 },
  row: { display: 'flex', alignItems: 'center', gap: 6 },
  input: { flex: 1, maxWidth: 80, padding: '3px 5px', fontSize: 12 },
  select: { flex: 1, padding: '3px 5px', fontSize: 12 },
  btn: {
    padding: '3px 8px', border: '1px solid #555', borderRadius: 4,
    background: '#3a3a6a', color: '#ddd', cursor: 'pointer', fontSize: 11,
  },
  btnDanger: {
    padding: '3px 8px', border: '1px solid #c33', borderRadius: 4,
    background: '#4a2020', color: '#faa', cursor: 'pointer', fontSize: 11,
  },
  item: {
    padding: 8, border: '1px solid #444', borderRadius: 4, background: '#22223a',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  itemSelected: { borderColor: '#77f' },
  empty: { fontSize: 12, color: '#666', textAlign: 'center' as const, paddingTop: 40 },
  checkbox: { marginRight: 4 },
};
