import { useEffect, useMemo, useRef, useState } from 'react';
import { zipSync } from 'fflate';
import type { StudioTarget } from '../App';
import { extractSprite, spriteColors } from '../lib/sprite';
import { autoMap, usedFilaments, type ColorMapping, type Filament } from '../lib/palette';
import { autoBaseSize, BASE_SIZES, buildModel, DEFAULT_MODEL, tabThickness, type ModelMode, type ModelSettings } from '../lib/model';
import { slotDepth, type StandShape } from '../lib/stand';
import { meshVolume, translateMesh } from '../lib/mesh';
import { luminance } from '../lib/color';
import { to3mf } from '../lib/export/threemf';
import { toStl } from '../lib/export/stl';
import { download, gridToDataUrl } from '../lib/image';
import { saveDesign, uid, type DesignRecord } from '../lib/storage';
import Viewer3D, { type ViewerHandle } from './Viewer3D';
import { FilamentPicker, NumberField, Segmented, Swatch, Toggle } from './fields';
import FilamentManager from './FilamentManager';

interface Props {
  target: StudioTarget;
  filaments: Filament[];
  onFilaments: (f: Filament[]) => void;
  onSaved: (d: DesignRecord) => void;
}

const PLA_DENSITY = 1.24; // g/cm³

const MODES: { value: ModelMode; label: string; help: string }[] = [
  {
    value: 'one-sided',
    label: '1-sided',
    help: 'Colors on the front face over a backing core. Color changes happen only in the top layers, so it prints fastest.',
  },
  {
    value: 'two-sided',
    label: '2-sided',
    help: 'Colored faces on front and back around a backing core. The back shows the mirrored sprite.',
  },
  {
    value: 'stacked',
    label: 'Stacked',
    help: 'Each filament rises to its own level, so colors read as raised layers. Set the levels in the color list.',
  },
  {
    value: 'flat',
    label: 'Flat',
    help: 'One level. Every pixel is a full-thickness column of its color, visible from both sides and the edges.',
  },
];

function defaultLevels(ids: string[], filaments: Filament[], existing: Record<string, number>) {
  const hex = (id: string) => filaments.find((f) => f.id === id)?.hex ?? '#808080';
  // Brightest filament lowest, darkest (usually the outline) on top.
  const sorted = [...ids].sort((a, b) => luminance(hex(b)) - luminance(hex(a)));
  const out: Record<string, number> = {};
  sorted.forEach((id, i) => (out[id] = existing[id] ?? i));
  return out;
}

export default function Studio({ target, filaments, onFilaments, onSaved }: Props) {
  const { sheet, rect, design } = target;
  const [scale, setScale] = useState<number | 'auto'>(design?.scale ?? 'auto');
  const grid = useMemo(() => extractSprite(sheet.img, rect, sheet.record.slice.background, scale), [sheet, rect, scale]);
  const colors = useMemo(() => spriteColors(grid), [grid]);

  const [maxColors, setMaxColors] = useState(design?.maxColors ?? 4);
  const [mapping, setMapping] = useState<ColorMapping>(() => design?.mapping ?? autoMap(colors, filaments, maxColors));
  const [model, setModel] = useState<ModelSettings>(() => {
    if (design) return design.model;
    const pixelSize = Math.min(3, Math.max(0.5, Math.round((40 / Math.max(1, grid.h)) * 10) / 10));
    return { ...DEFAULT_MODEL, pixelSize };
  });
  const [name, setName] = useState(design?.name ?? `${sheet.record.name} sprite ${(target.index ?? 0) + 1}`);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [showFilaments, setShowFilaments] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const viewer = useRef<ViewerHandle>(null);

  // Any color that has no filament yet (e.g. after changing the pixel scale) gets the nearest one.
  useEffect(() => {
    if (colors.some((c) => !mapping[c.hex])) setMapping((m) => ({ ...autoMap(colors, filaments, maxColors), ...m }));
  }, [colors, mapping, filaments, maxColors]);

  const used = useMemo(() => usedFilaments(mapping, colors), [mapping, colors]);
  const fil = (id: string) => filaments.find((f) => f.id === id);
  const set = (patch: Partial<ModelSettings>) => setModel((m) => ({ ...m, ...patch }));
  const setStand = (patch: Partial<ModelSettings['stand']>) => setModel((m) => ({ ...m, stand: { ...m.stand, ...patch } }));

  const levels = useMemo(() => defaultLevels(used, filaments, model.levels), [used, filaments, model.levels]);

  // Resolve automatic stand size before building.
  const effective = useMemo<ModelSettings>(() => {
    const st = model.stand;
    let lo = Infinity, hi = -1;
    for (let i = 0; i < grid.w; i++) if (grid.px[(grid.h - 1) * grid.w + i]) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    const tabLen = hi >= 0 ? (hi - lo + 1) * model.pixelSize : 0;
    const auto = autoBaseSize(tabLen, tabThickness(model));
    const width = st.autoSize ? auto : st.width;
    const depth = st.autoSize ? Math.max(tabThickness(model) + 8, Math.round(auto * 0.65)) : st.depth;
    return { ...model, levels, stand: { ...st, width, depth } };
  }, [model, levels, grid]);

  const built = useMemo(() => buildModel(grid, mapping, effective), [grid, mapping, effective]);
  const colorMap = useMemo(() => Object.fromEntries(filaments.map((f) => [f.id, f.hex])), [filaments]);

  const usage = useMemo(() => {
    const g = new Map<string, number>();
    const add = (id: string, mm3: number) => g.set(id, (g.get(id) ?? 0) + (mm3 / 1000) * PLA_DENSITY);
    for (const p of built.parts) add(p.filamentId, meshVolume(p.mesh));
    if (built.stand) add(built.stand.filamentId, meshVolume(built.stand.mesh));
    return g;
  }, [built]);
  const totalGrams = [...usage.values()].reduce((a, b) => a + b, 0);

  const pick = (col: number, row: number) => {
    const hex = grid.px[row * grid.w + col];
    if (hex) setPickerFor(hex);
  };

  useEffect(() => {
    if (!pickerFor) return;
    document.getElementById(`color-${pickerFor.slice(1)}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [pickerFor]);

  const safeName = name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pixel-figure';

  const exportParts = () => {
    const figure = built.parts.map((p) => ({
      name: fil(p.filamentId)?.name ?? p.filamentId,
      color: fil(p.filamentId)?.hex ?? '#808080',
      mesh: p.mesh,
    }));
    const standOffset: [number, number, number] = [built.width + 10 + effective.stand.width / 2, effective.stand.depth / 2, 0];
    return { figure, standOffset };
  };

  const export3mf = () => {
    const { figure, standOffset } = exportParts();
    const objects = [{ name, parts: figure, offset: [0, 0, 0] as [number, number, number] }];
    if (built.stand)
      objects.push({
        name: `${name} stand`,
        parts: [{ name: 'Stand', color: fil(built.stand.filamentId)?.hex ?? '#000000', mesh: built.stand.mesh }],
        offset: standOffset,
      });
    download(to3mf(objects), `${safeName}.3mf`, 'model/3mf');
    flash('3MF downloaded');
  };

  const exportStl = () => {
    const { standOffset } = exportParts();
    const meshes = built.parts.map((p) => p.mesh);
    if (built.stand) meshes.push(translateMesh(built.stand.mesh, ...standOffset));
    download(toStl(meshes), `${safeName}.stl`, 'model/stl');
    flash('STL downloaded');
  };

  const exportStlZip = () => {
    const files: Record<string, Uint8Array> = {};
    for (const p of built.parts) files[`${safeName}-${(fil(p.filamentId)?.name ?? p.filamentId).replace(/\s+/g, '-')}.stl`] = toStl([p.mesh]);
    if (built.stand) files[`${safeName}-stand.stl`] = toStl([built.stand.mesh]);
    download(zipSync(files), `${safeName}-stl.zip`, 'application/zip');
    flash('STL files downloaded');
  };

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
  };

  const save = async () => {
    const d: DesignRecord = {
      id: design?.id ?? uid(),
      name,
      sheetId: sheet.record.id,
      rect,
      scale,
      mapping,
      model: { ...model, levels },
      maxColors,
      thumb: gridToDataUrl(grid, 4),
      updated: Date.now(),
    };
    try {
      await saveDesign(d);
      onSaved(d);
      flash('Saved to library');
    } catch {
      flash('Could not save: browser storage is blocked');
    }
  };

  const sd = slotDepth(effective.stand);
  const mode = MODES.find((m) => m.value === model.mode)!;

  return (
    <div className="studio">
      <aside className="panel colors-panel">
        <div className="panel-head">
          <input
            id="design-name"
            className="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Figure name"
          />
        </div>

        <h2 className="label">
          Colors <span className="label-note">{colors.length} in sprite → {used.length} filaments</span>
        </h2>
        <div className="max-colors">
          <label className="field-label" htmlFor="max-colors">
            Max filaments
          </label>
          <select id="max-colors" value={maxColors} onChange={(e) => setMaxColors(+e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 12, 16].map((n) => (
              <option key={n} value={n}>
                {n}
                {n === 4 ? ' · 1 AMS' : n === 8 ? ' · 2 AMS' : n === 16 ? ' · 4 AMS' : ''}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={() => setMapping(autoMap(colors, filaments, maxColors))}>
            Auto-match
          </button>
        </div>

        <ul className="color-list">
          {colors.map((c) => {
            const fid = mapping[c.hex];
            return (
              <li key={c.hex} id={`color-${c.hex.slice(1)}`} className={pickerFor === c.hex ? 'active' : ''}>
                <Swatch hex={c.hex} size={22} />
                <span className="arrow" aria-hidden="true">
                  →
                </span>
                <FilamentPicker
                  value={fid}
                  filaments={filaments}
                  open={pickerFor === c.hex}
                  onOpenChange={(o) => setPickerFor(o ? c.hex : null)}
                  onChange={(id) => setMapping({ ...mapping, [c.hex]: id })}
                />
                <span className="count mono">{c.count}px</span>
              </li>
            );
          })}
        </ul>
        <p className="hint">Click a pixel on the model to change its color.</p>

        {model.mode === 'stacked' && (
          <>
            <h2 className="label">Levels</h2>
            <ul className="level-list">
              {used.map((id) => (
                <li key={id}>
                  <Swatch hex={fil(id)?.hex ?? '#888'} />
                  <span className="grow">{fil(id)?.name ?? id}</span>
                  <button
                    className="btn small ghost"
                    aria-label="Lower"
                    onClick={() => set({ levels: { ...levels, [id]: Math.max(0, levels[id] - 1) } })}
                  >
                    −
                  </button>
                  <span className="mono level">{levels[id]}</span>
                  <button
                    className="btn small ghost"
                    aria-label="Raise"
                    onClick={() => set({ levels: { ...levels, [id]: Math.min(12, levels[id] + 1) } })}
                  >
                    +
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <button className="btn ghost wide" onClick={() => setShowFilaments(!showFilaments)} aria-expanded={showFilaments}>
          {showFilaments ? 'Hide my filaments' : 'Edit my filaments'}
        </button>
        {showFilaments && <FilamentManager filaments={filaments} onChange={onFilaments} />}
      </aside>

      <section className="stage">
        <Viewer3D
          ref={viewer}
          model={built}
          colors={colorMap}
          standHeight={effective.stand.height}
          slotDepth={sd}
          onPick={pick}
        />
        <div className="stage-tools">
          {(['fit', 'front', 'back', 'side'] as const).map((v) => (
            <button key={v} className="btn small glass" onClick={() => viewer.current?.view(v)}>
              {v === 'fit' ? 'Reset view' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="dims glass">
          <div className="dims-title">{built.stand ? `${effective.stand.shape} base` : 'No stand'}</div>
          {built.stand && (
            <div className="dims-big mono">
              {effective.stand.shape === 'round' || effective.stand.shape === 'square'
                ? `Ø ${effective.stand.width} mm`
                : `${effective.stand.width} × ${effective.stand.depth} mm`}
            </div>
          )}
          <div className="dims-row mono">
            <span>Figure</span>
            {built.width.toFixed(1)} × {built.height.toFixed(1)} × {built.thickness.toFixed(1)} mm
          </div>
          <div className="dims-row mono">
            <span>Sprite</span>
            {grid.w} × {grid.h} px
          </div>
          <div className="dims-row mono">
            <span>PLA</span>≈ {totalGrams.toFixed(1)} g
          </div>
        </div>
        {status && <div className="status glass">{status}</div>}
      </section>

      <aside className="panel settings-panel">
        <h2 className="label">Style</h2>
        <Segmented value={model.mode} options={MODES} onChange={(mode) => set({ mode })} />
        <p className="help">{mode.help}</p>

        <h2 className="label">Size</h2>
        <div className="fields two">
          <NumberField
            id="pixel-size"
            label="Pixel size"
            unit="mm"
            step={0.1}
            min={0.2}
            max={10}
            value={model.pixelSize}
            onChange={(pixelSize) => set({ pixelSize })}
          />
          <NumberField
            id="fig-height"
            label="Sprite height"
            unit="mm"
            step={1}
            min={2}
            value={grid.h * model.pixelSize}
            onChange={(h) => set({ pixelSize: h / Math.max(1, grid.h) })}
          />
          {model.mode === 'stacked' ? (
            <>
              <NumberField id="stack-base" label="Base" unit="mm" step={0.2} min={0.4} value={model.stackBase} onChange={(stackBase) => set({ stackBase })} />
              <NumberField id="stack-step" label="Per level" unit="mm" step={0.2} min={0.2} value={model.stackStep} onChange={(stackStep) => set({ stackStep })} />
            </>
          ) : (
            <NumberField id="thickness" label="Thickness" unit="mm" step={0.2} min={0.4} value={model.thickness} onChange={(thickness) => set({ thickness })} />
          )}
          {(model.mode === 'one-sided' || model.mode === 'two-sided') && (
            <NumberField
              id="cap"
              label="Color depth"
              unit="mm"
              step={0.2}
              min={0.2}
              value={model.capThickness}
              onChange={(capThickness) => set({ capThickness })}
              hint="Use a multiple of your layer height, e.g. 0.6 mm = 3 layers at 0.2 mm"
            />
          )}
          <label className="field" htmlFor="px-scale">
            <span className="field-label">Sheet pixel scale</span>
            <select
              id="px-scale"
              value={String(scale)}
              onChange={(e) => setScale(e.target.value === 'auto' ? 'auto' : +e.target.value)}
            >
              <option value="auto">Auto</option>
              {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
        </div>
        {(model.mode !== 'flat' && model.mode !== 'stacked') || model.stand.enabled ? (
          <div className="inline-field">
            <span className="field-label">{model.mode === 'one-sided' || model.mode === 'two-sided' ? 'Core filament' : 'Tab filament'}</span>
            <FilamentPicker value={model.backingId} filaments={filaments} onChange={(backingId) => set({ backingId })} />
          </div>
        ) : null}

        <h2 className="label">Stand</h2>
        <Toggle id="stand-on" label="Slot-in stand" checked={model.stand.enabled} onChange={(enabled) => setStand({ enabled })} />
        {model.stand.enabled && (
          <>
            <Segmented
              value={model.stand.shape}
              options={[
                { value: 'round', label: 'Round' },
                { value: 'oval', label: 'Oval' },
                { value: 'square', label: 'Square' },
                { value: 'rect', label: 'Rect' },
              ] as { value: StandShape; label: string }[]}
              onChange={(shape) => setStand({ shape })}
            />
            <div className="field">
              <span className="field-label">Base size</span>
              <div className="chips">
                <button className={'chip' + (model.stand.autoSize ? ' on' : '')} onClick={() => setStand({ autoSize: true })}>
                  Auto
                </button>
                {BASE_SIZES.map((d) => (
                  <button
                    key={d}
                    className={'chip mono' + (!model.stand.autoSize && model.stand.width === d ? ' on' : '')}
                    onClick={() => setStand({ autoSize: false, width: d, depth: Math.round(d * 0.65) })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="fields two">
              <NumberField
                id="stand-w"
                label={model.stand.shape === 'round' ? 'Diameter' : 'Width'}
                unit="mm"
                min={5}
                value={effective.stand.width}
                onChange={(width) => setStand({ autoSize: false, width, depth: effective.stand.depth })}
              />
              {(model.stand.shape === 'oval' || model.stand.shape === 'rect') && (
                <NumberField
                  id="stand-d"
                  label="Depth"
                  unit="mm"
                  min={5}
                  value={effective.stand.depth}
                  onChange={(depth) => setStand({ autoSize: false, depth, width: effective.stand.width })}
                />
              )}
              <NumberField id="stand-h" label="Height" unit="mm" step={0.5} min={1.5} value={model.stand.height} onChange={(height) => setStand({ height })} />
              <NumberField id="slot-d" label="Slot depth" unit="mm" step={0.2} min={0.4} value={model.stand.slotDepth} onChange={(slotDepth) => setStand({ slotDepth })} />
              <NumberField
                id="clearance"
                label="Slot clearance"
                unit="mm"
                step={0.05}
                min={0}
                max={1}
                value={model.stand.clearance}
                onChange={(clearance) => setStand({ clearance })}
                hint="Gap on each side of the tab. 0.1–0.2 mm gives a snug press fit on most printers"
              />
              <NumberField id="chamfer" label="Edge bevel" unit="mm" step={0.2} min={0} value={model.stand.chamfer} onChange={(chamfer) => setStand({ chamfer })} />
            </div>
            <div className="inline-field">
              <span className="field-label">Stand filament</span>
              <FilamentPicker value={model.stand.filamentId} filaments={filaments} onChange={(filamentId) => setStand({ filamentId })} />
            </div>
          </>
        )}

        <h2 className="label">Filament use</h2>
        <ul className="usage">
          {[...usage.entries()].map(([id, g]) => (
            <li key={id}>
              <Swatch hex={fil(id)?.hex ?? '#888'} />
              <span className="grow">{fil(id)?.name ?? id}</span>
              <span className="mono">{g.toFixed(1)} g</span>
            </li>
          ))}
        </ul>

        <div className="export">
          <button className="btn primary wide" onClick={export3mf}>
            Download 3MF (multi-color)
          </button>
          <div className="export-row">
            <button className="btn" onClick={exportStl}>
              STL
            </button>
            <button className="btn" onClick={exportStlZip}>
              STL per color
            </button>
            <button className="btn" onClick={save}>
              {design ? 'Save' : 'Save to library'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
