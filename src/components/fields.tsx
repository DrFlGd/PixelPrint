import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Filament } from '../lib/palette';
import { inkFor } from '../lib/color';

export function NumberField(p: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  hint?: string;
}) {
  const [text, setText] = useState(String(round(p.value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(round(p.value)));
  }, [p.value]);
  const commit = (t: string) => {
    const v = parseFloat(t);
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
    p.onChange(clamped);
  };
  return (
    <label className="field" htmlFor={p.id} title={p.hint}>
      <span className="field-label">{p.label}</span>
      <span className="num-input">
        <input
          id={p.id}
          type="number"
          inputMode="decimal"
          value={text}
          step={p.step ?? 1}
          min={p.min}
          max={p.max}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(String(round(p.value)));
          }}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
        />
        {p.unit && <span className="unit">{p.unit}</span>}
      </span>
    </label>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function Segmented<T extends string>(p: {
  label?: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="field">
      {p.label && <span className="field-label">{p.label}</span>}
      <div className="segmented" role="radiogroup" aria-label={p.label}>
        {p.options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={p.value === o.value}
            className={p.value === o.value ? 'on' : ''}
            title={o.title}
            onClick={() => p.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle(p: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" htmlFor={p.id}>
      <input id={p.id} type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{p.label}</span>
    </label>
  );
}

export function Swatch({ hex, size = 18 }: { hex: string; size?: number }) {
  return <span className="swatch" style={{ background: hex, width: size, height: size }} />;
}

/** Filament picker: swatch button that opens a list of filaments. */
export function FilamentPicker(p: {
  value: string;
  filaments: Filament[];
  onChange: (id: string) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  label?: ReactNode;
}) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = p.open ?? openLocal;
  const setOpen = p.onOpenChange ?? setOpenLocal;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, setOpen]);
  const current = p.filaments.find((f) => f.id === p.value);
  const owned = p.filaments.filter((f) => f.owned);
  const other = p.filaments.filter((f) => !f.owned);
  return (
    <div className="picker" ref={ref}>
      <button
        className="picker-btn"
        style={{ background: current?.hex ?? '#000', color: inkFor(current?.hex ?? '#000') }}
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {p.label ?? current?.name ?? 'Pick filament'}
      </button>
      {open && (
        <div className="picker-pop" role="listbox">
          {[
            ['On hand', owned],
            ['Other filaments', other],
          ].map(([title, list]) =>
            (list as Filament[]).length ? (
              <div key={title as string}>
                <div className="picker-group">{title as string}</div>
                {(list as Filament[]).map((f) => (
                  <button
                    key={f.id}
                    role="option"
                    aria-selected={f.id === p.value}
                    className={'picker-opt' + (f.id === p.value ? ' on' : '')}
                    onClick={() => {
                      p.onChange(f.id);
                      setOpen(false);
                    }}
                  >
                    <Swatch hex={f.hex} />
                    {f.name}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
