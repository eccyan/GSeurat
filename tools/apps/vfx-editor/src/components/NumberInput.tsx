import React, { useCallback, useRef, useState } from 'react';
import { inputStyle as themeInputStyle, labelStyle as themeLabelStyle } from '../styles/theme.js';

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  style?: React.CSSProperties;
}

function formatValue(v: number): string {
  // Remove trailing zeros: "12.500" -> "12.5", "12.0" -> "12"
  return parseFloat(v.toFixed(10)).toString();
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

const defaultInputStyle: React.CSSProperties = themeInputStyle;
const labelStyle: React.CSSProperties = themeLabelStyle;

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  style,
}: NumberInputProps) {
  const [text, setText] = useState(() => formatValue(value));
  const [focused, setFocused] = useState(false);
  const prevValue = useRef(value);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragging = useRef(false);
  const pointerIsDown = useRef(false);

  // Keep text in sync with external value changes when not focused
  if (!focused && value !== prevValue.current) {
    prevValue.current = value;
  }
  const displayText = focused ? text : formatValue(value);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseFloat(raw);
      if (isNaN(parsed)) {
        // Revert to previous value
        setText(formatValue(value));
        return;
      }
      const clamped = clamp(parsed, min, max);
      onChange(clamped);
      setText(formatValue(clamped));
    },
    [value, min, max, onChange],
  );

  const handleFocus = useCallback(() => {
    setFocused(true);
    setText(formatValue(value));
  }, [value]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    commit(text);
  }, [text, commit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        commit(text);
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
        setText(formatValue(value));
        setFocused(false);
        (e.target as HTMLInputElement).blur();
      }
    },
    [text, commit, value],
  );

  // Drag-to-scrub on label
  const handleLabelPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStartX.current = e.clientX;
      dragStartValue.current = value;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [value],
  );

  const handleLabelPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStartX.current;
      const delta = Math.round(dx / 2) * step;
      const newVal = clamp(dragStartValue.current + delta, min, max);
      onChange(newVal);
    },
    [step, min, max, onChange],
  );

  const handleLabelPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <>
      {label && (
        <span
          style={labelStyle}
          onPointerDown={handleLabelPointerDown}
          onPointerMove={handleLabelPointerMove}
          onPointerUp={handleLabelPointerUp}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        value={displayText}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => {
          // Only initiate drag tracking if not already focused (typing mode)
          if (document.activeElement !== e.currentTarget) {
            e.preventDefault(); // prevent focus on mousedown — we'll focus on click
            pointerIsDown.current = true;
            dragStartX.current = e.clientX;
            dragStartValue.current = value;
            dragging.current = false;
          }
        }}
        onPointerMove={(e) => {
          if (!pointerIsDown.current || focused) return;
          const dx = e.clientX - dragStartX.current;
          if (!dragging.current && Math.abs(dx) < 3) return;
          if (!dragging.current) {
            dragging.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
          const delta = Math.round(dx / 2) * step;
          const newVal = clamp(dragStartValue.current + delta, min, max);
          onChange(newVal);
        }}
        onPointerUp={(e) => {
          pointerIsDown.current = false;
          if (dragging.current) {
            dragging.current = false;
            try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
          } else if (!focused) {
            // No drag happened — allow focus for typing
            (e.target as HTMLInputElement).focus();
          }
        }}
        style={{ ...defaultInputStyle, cursor: focused ? 'text' : 'ew-resize', ...style }}
      />
    </>
  );
}
