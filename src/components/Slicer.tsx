import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenSheet } from '../App';
import type { SheetRecord } from '../lib/storage';
import { extractSprite, pixelHex, sliceSheet, type Rect, type SliceSettings } from '../lib/sprite';
import { gridToDataUrl } from '../lib/image';
import { NumberField, Segmented, Swatch } from './fields';

interface Props {
  sheet: OpenSheet;
  onChange: (r: SheetRecord) => void;
  onBuild: (rect: Rect, index: number) => void;
}

export default function Slicer({ sheet, onChange, onBuild }: Props) {
  const { img, record } = sheet;
  const s = record.slice;
  const set = (patch: Partial<SliceSettings>) => onChange({ ...record, slice: { ...s, ...patch } });
  const rects = useMemo(() => sliceSheet(img, s), [img, s]);
  const [selected, setSelected] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);

  // Fit the sheet to the available space at an integer zoom.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const z = Math.max(1, Math.floor(Math.min((el.clientWidth - 32) / img.width, (el.clientHeight - 32) / img.height)));
    setZoom(Math.min(z, 16));
  }, [img]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = img.width * zoom;
    c.height = img.height * zoom;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const src = document.createElement('canvas');
    src.width = img.width;
    src.height = img.height;
    src.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(src, 0, 0, c.width, c.height);
    rects.forEach((r, i) => {
      const on = i === selected;
      const hv = i === hover;
      ctx.lineWidth = on ? 2 : 1;
      ctx.strokeStyle = on ? '#ffb547' : hv ? 'rgba(255,255,255,0.9)' : 'rgba(120,200,255,0.65)';
      ctx.strokeRect(r.x * zoom + 0.5, r.y * zoom + 0.5, r.w * zoom - 1, r.h * zoom - 1);
    });
  }, [img, rects, zoom, selected, hover]);

  const at = (e: React.MouseEvent) => {
    const b = canvas.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - b.left) / b.width) * img.width),
      y: Math.floor(((e.clientY - b.top) / b.height) * img.height),
    };
  };
  const hit = (x: number, y: number) => rects.findIndex((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h);

  const thumbs = useMemo(
    () => rects.map((r) => gridToDataUrl(extractSprite(img, r, s.background), 3)),
    [rects, img, s.background],
  );
  const sel = rects[selected];

  return (
    <div className="slicer">
      <aside className="panel">
        <h2 className="label">Find sprites</h2>
        <Segmented
          value={s.mode}
          options={[
            { value: 'auto', label: 'Auto-detect' },
            { value: 'grid', label: 'Grid' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        {s.mode === 'auto' ? (
          <div className="fields">
            <NumberField
              id="merge-gap"
              label="Join pieces within"
              unit="px"
              min={0}
              max={32}
              value={s.mergeGap}
              onChange={(mergeGap) => set({ mergeGap })}
              hint="Keeps detached parts, like a floating weapon, with their sprite"
            />
            <NumberField
              id="min-px"
              label="Ignore specks under"
              unit="px"
              min={1}
              value={s.minPixels}
              onChange={(minPixels) => set({ minPixels })}
            />
          </div>
        ) : (
          <div className="fields two">
            <NumberField id="cell-w" label="Cell width" unit="px" min={1} value={s.cellW} onChange={(cellW) => set({ cellW })} />
            <NumberField id="cell-h" label="Cell height" unit="px" min={1} value={s.cellH} onChange={(cellH) => set({ cellH })} />
            <NumberField id="off-x" label="Offset X" unit="px" min={0} value={s.offsetX} onChange={(offsetX) => set({ offsetX })} />
            <NumberField id="off-y" label="Offset Y" unit="px" min={0} value={s.offsetY} onChange={(offsetY) => set({ offsetY })} />
            <NumberField id="gap-x" label="Spacing X" unit="px" min={0} value={s.gapX} onChange={(gapX) => set({ gapX })} />
            <NumberField id="gap-y" label="Spacing Y" unit="px" min={0} value={s.gapY} onChange={(gapY) => set({ gapY })} />
          </div>
        )}

        <h2 className="label">Background</h2>
        <Segmented
          value={s.background.mode}
          options={[
            { value: 'alpha', label: 'Transparent' },
            { value: 'color', label: 'Solid color' },
          ]}
          onChange={(mode) =>
            set({ background: mode === 'alpha' ? { mode } : { mode, hex: pixelHex(img, 0, 0) } })
          }
        />
        {s.background.mode === 'color' && (
          <div className="bg-row">
            <Swatch hex={s.background.hex} size={22} />
            <span className="mono">{s.background.hex}</span>
            <button className={'btn small' + (picking ? ' primary' : '')} onClick={() => setPicking(!picking)}>
              {picking ? 'Click the backdrop…' : 'Pick from sheet'}
            </button>
          </div>
        )}

        <div className="panel-foot">
          <div className="stat">
            <span className="mono big">{rects.length}</span> sprites found
          </div>
          <div className="zoom">
            <button className="btn small ghost" onClick={() => setZoom((z) => Math.max(1, z - 1))} aria-label="Zoom out">
              −
            </button>
            <span className="mono">{zoom}×</span>
            <button className="btn small ghost" onClick={() => setZoom((z) => Math.min(32, z + 1))} aria-label="Zoom in">
              +
            </button>
          </div>
        </div>
      </aside>

      <div className="sheet-view checker" ref={wrap}>
        <canvas
          ref={canvas}
          className={'sheet-canvas' + (picking ? ' picking' : '')}
          onMouseMove={(e) => {
            const { x, y } = at(e);
            const i = hit(x, y);
            setHover(i >= 0 ? i : null);
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const { x, y } = at(e);
            if (picking) {
              set({ background: { mode: 'color', hex: pixelHex(img, x, y) } });
              setPicking(false);
              return;
            }
            const i = hit(x, y);
            if (i >= 0) setSelected(i);
          }}
          onDoubleClick={(e) => {
            const { x, y } = at(e);
            const i = hit(x, y);
            if (i >= 0) onBuild(rects[i], i);
          }}
        />
      </div>

      <aside className="panel sprite-list">
        <h2 className="label">Sprites</h2>
        <div className="thumbs">
          {thumbs.map((t, i) => (
            <button
              key={i}
              className={'thumb checker' + (i === selected ? ' on' : '')}
              onClick={() => setSelected(i)}
              onDoubleClick={() => onBuild(rects[i], i)}
              aria-label={`Sprite ${i + 1}`}
            >
              <img src={t} alt="" className="pixelated" />
            </button>
          ))}
        </div>
        <div className="panel-foot">
          {sel ? (
            <>
              <div className="card-meta mono">
                #{selected + 1} · {sel.w} × {sel.h} px at {sel.x},{sel.y}
              </div>
              <button className="btn primary wide" onClick={() => onBuild(sel, selected)}>
                Build this sprite
              </button>
            </>
          ) : (
            <p className="empty">No sprites found. Check the background setting.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
