import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesignRecord, SheetRecord } from '../lib/storage';

interface Props {
  sheets: SheetRecord[];
  designs: DesignRecord[];
  onImport: (files: FileList | File[]) => void;
  onOpenSheet: (s: SheetRecord) => void;
  onOpenDesign: (d: DesignRecord) => void;
  onDeleteSheet: (id: string) => void;
  onDeleteDesign: (id: string) => void;
}

function useObjectUrl(blob: Blob) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return url;
}

function SheetCard({ sheet, onOpen, onDelete }: { sheet: SheetRecord; onOpen: () => void; onDelete: () => void }) {
  const url = useObjectUrl(sheet.image);
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="card sheet-card">
      <button className="sheet-thumb checker" onClick={onOpen} aria-label={`Open ${sheet.name}`}>
        <img src={url} alt="" className="pixelated" />
      </button>
      <div className="card-body">
        <div className="card-title">
          {sheet.name}
          {sheet.sample && <span className="pill">Example</span>}
        </div>
        <div className="card-meta mono">
          {sheet.width} × {sheet.height} px
        </div>
      </div>
      <div className="card-actions">
        <button className="btn small" onClick={onOpen}>
          Slice
        </button>
        {confirm ? (
          <>
            <button className="btn small danger" onClick={onDelete}>
              Delete sheet
            </button>
            <button className="btn small ghost" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn small ghost" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
    </article>
  );
}

export default function Library(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) p.onImport(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  return (
    <div className="library">
      <section
        className={'dropzone' + (drag ? ' over' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          p.onImport(e.dataTransfer.files);
        }}
      >
        <div>
          <h1 className="display">Sprites in, figures out.</h1>
          <p className="lede">
            Import a sprite sheet, pick a sprite, map its colors to your filaments, and export a multi-color 3MF ready
            for the slicer.
          </p>
        </div>
        <div className="drop-actions">
          <button className="btn primary" onClick={() => input.current?.click()}>
            Import sprite sheet
          </button>
          <span className="hint">or drop or paste a PNG here</span>
          <input
            ref={input}
            id="sheet-file"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) p.onImport(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </section>

      {p.designs.length > 0 && (
        <section className="shelf">
          <h2 className="label">Saved figures</h2>
          <div className="design-grid">
            {p.designs.map((d) => (
              <article key={d.id} className="card design-card">
                <button className="design-thumb checker" onClick={() => p.onOpenDesign(d)} aria-label={`Open ${d.name}`}>
                  <img src={d.thumb} alt="" className="pixelated" />
                </button>
                <div className="card-body">
                  <div className="card-title">{d.name}</div>
                  <div className="card-meta">{modeLabel(d.model.mode)}</div>
                </div>
                <div className="card-actions">
                  <button className="btn small" onClick={() => p.onOpenDesign(d)}>
                    Open
                  </button>
                  <button className="btn small ghost" onClick={() => p.onDeleteDesign(d.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="shelf">
        <h2 className="label">Sprite sheets</h2>
        {p.sheets.length === 0 ? (
          <p className="empty">No sheets yet. Import one to get started.</p>
        ) : (
          <div className="sheet-grid">
            {p.sheets.map((s) => (
              <SheetCard key={s.id} sheet={s} onOpen={() => p.onOpenSheet(s)} onDelete={() => p.onDeleteSheet(s.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function modeLabel(mode: string) {
  return (
    { flat: 'Flat, all colors', 'one-sided': 'One-sided', 'two-sided': 'Two-sided', stacked: 'Stacked levels' } as Record<
      string,
      string
    >
  )[mode];
}
