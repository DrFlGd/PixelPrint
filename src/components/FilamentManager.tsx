import { useState } from 'react';
import type { Filament } from '../lib/palette';
import { DEFAULT_FILAMENTS } from '../lib/palette';
import { uid } from '../lib/storage';

export default function FilamentManager({ filaments, onChange }: { filaments: Filament[]; onChange: (f: Filament[]) => void }) {
  const [name, setName] = useState('');
  const [hex, setHex] = useState('#e05a9c');
  const update = (id: string, patch: Partial<Filament>) => onChange(filaments.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  return (
    <div className="filaments">
      <p className="hint">Tick the filaments you have loaded. Auto-match only uses ticked ones.</p>
      <ul>
        {filaments.map((f) => (
          <li key={f.id}>
            <input
              id={`own-${f.id}`}
              type="checkbox"
              checked={f.owned}
              onChange={(e) => update(f.id, { owned: e.target.checked })}
              aria-label={`I have ${f.name}`}
            />
            <input
              id={`hex-${f.id}`}
              type="color"
              value={f.hex}
              onChange={(e) => update(f.id, { hex: e.target.value })}
              aria-label={`${f.name} color`}
            />
            <input
              id={`name-${f.id}`}
              className="grow plain"
              value={f.name}
              onChange={(e) => update(f.id, { name: e.target.value })}
              aria-label="Filament name"
            />
            {f.id.startsWith('custom-') && (
              <button className="btn small ghost" onClick={() => onChange(filaments.filter((x) => x.id !== f.id))}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="add-filament"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onChange([...filaments, { id: 'custom-' + uid(), name: name.trim(), hex, owned: true }]);
          setName('');
        }}
      >
        <input id="new-fil-hex" type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label="New filament color" />
        <input id="new-fil-name" className="grow" placeholder="e.g. Silk Gold" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" type="submit">
          Add
        </button>
      </form>
      <button className="link" onClick={() => onChange(DEFAULT_FILAMENTS)}>
        Reset to default list
      </button>
    </div>
  );
}
