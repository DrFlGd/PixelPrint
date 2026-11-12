import { useCallback, useEffect, useState } from 'react';
import Library from './components/Library';
import Slicer from './components/Slicer';
import Studio from './components/Studio';
import { DEFAULT_FILAMENTS, type Filament } from './lib/palette';
import { DEFAULT_SLICE, guessBackground, type Rect } from './lib/sprite';
import { blobToImageData } from './lib/image';
import { makeSampleSheet } from './lib/sample';
import * as db from './lib/storage';

type View = 'library' | 'slice' | 'studio';

export interface OpenSheet {
  record: db.SheetRecord;
  img: ImageData;
}

export interface StudioTarget {
  sheet: OpenSheet;
  rect: Rect;
  index?: number;
  design?: db.DesignRecord;
}

export default function App() {
  const [view, setView] = useState<View>('library');
  const [sheets, setSheets] = useState<db.SheetRecord[]>([]);
  const [designs, setDesigns] = useState<db.DesignRecord[]>([]);
  const [filaments, setFilamentsState] = useState<Filament[]>(DEFAULT_FILAMENTS);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [target, setTarget] = useState<StudioTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSheets(await db.listSheets());
    setDesigns(await db.listDesigns());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const f = await db.loadFilaments();
        if (f?.length) setFilamentsState(f);
        if (!(await db.getFlag('seeded'))) {
          const image = await makeSampleSheet();
          const img = await blobToImageData(image);
          await db.saveSheet({
            id: db.uid(),
            name: 'Example sheet',
            created: Date.now(),
            image,
            width: img.width,
            height: img.height,
            slice: { ...DEFAULT_SLICE, background: guessBackground(img) },
            sample: true,
          });
          await db.setFlag('seeded', true);
        }
      } catch (e) {
        setError('Your browser blocked local storage, so sheets will not be kept after you close this tab.');
        console.error(e);
      }
      await refresh().catch(() => {});
    })();
  }, [refresh]);

  const setFilaments = (f: Filament[]) => {
    setFilamentsState(f);
    db.saveFilaments(f).catch(() => {});
  };

  const importFiles = async (files: FileList | File[]) => {
    let last: db.SheetRecord | null = null;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const img = await blobToImageData(file);
        const rec: db.SheetRecord = {
          id: db.uid(),
          name: file.name.replace(/\.[^.]+$/, ''),
          created: Date.now(),
          image: file,
          width: img.width,
          height: img.height,
          slice: { ...DEFAULT_SLICE, background: guessBackground(img) },
        };
        await db.saveSheet(rec).catch(() => {});
        setSheets((s) => [rec, ...s.filter((x) => x.id !== rec.id)]);
        last = rec;
      } catch {
        setError(`Couldn't read ${file.name}. Use a PNG, GIF, BMP or WebP image.`);
      }
    }
    if (last) openSheet(last);
  };

  const openSheet = async (record: db.SheetRecord) => {
    const img = await blobToImageData(record.image);
    setSheet({ record, img });
    setView('slice');
  };

  const openDesign = async (d: db.DesignRecord) => {
    const record = sheets.find((s) => s.id === d.sheetId);
    if (!record) return setError('The sprite sheet for this design was deleted.');
    const img = await blobToImageData(record.image);
    const s = { record, img };
    setSheet(s);
    setTarget({ sheet: s, rect: d.rect, design: d });
    setView('studio');
  };

  const steps: { id: View; label: string; enabled: boolean }[] = [
    { id: 'library', label: 'Library', enabled: true },
    { id: 'slice', label: 'Slice', enabled: !!sheet },
    { id: 'studio', label: 'Build', enabled: !!target },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Pixel Print</span>
        </div>
        <nav className="steps" aria-label="Steps">
          {steps.map((s, i) => (
            <button
              key={s.id}
              className={'step' + (view === s.id ? ' active' : '')}
              disabled={!s.enabled}
              onClick={() => setView(s.id)}
            >
              <span className="step-n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          {sheet && view !== 'library' && <span className="crumb">{sheet.record.name}</span>}
        </div>
      </header>

      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="main">
        {view === 'library' && (
          <Library
            sheets={sheets}
            designs={designs}
            onImport={importFiles}
            onOpenSheet={openSheet}
            onOpenDesign={openDesign}
            onDeleteSheet={async (id) => {
              await db.deleteSheet(id);
              if (sheet?.record.id === id) {
                setSheet(null);
                setTarget(null);
              }
              refresh();
            }}
            onDeleteDesign={async (id) => {
              await db.deleteDesign(id);
              refresh();
            }}
          />
        )}
        {view === 'slice' && sheet && (
          <Slicer
            sheet={sheet}
            onChange={async (record) => {
              setSheet({ ...sheet, record });
              setSheets((all) => all.map((s) => (s.id === record.id ? record : s)));
              await db.saveSheet(record).catch(() => {});
            }}
            onBuild={(rect, index) => {
              setTarget({ sheet, rect, index });
              setView('studio');
            }}
          />
        )}
        {view === 'studio' && target && (
          <Studio
            key={target.design?.id ?? `${target.sheet.record.id}:${target.rect.x},${target.rect.y}`}
            target={target}
            filaments={filaments}
            onFilaments={setFilaments}
            onSaved={(d) => {
              setTarget({ ...target, design: d });
              refresh();
            }}
          />
        )}
      </main>
    </div>
  );
}
