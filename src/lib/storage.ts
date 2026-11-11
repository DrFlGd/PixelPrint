import { createStore, get, set, del, entries } from 'idb-keyval';
import type { Rect, SliceSettings } from './sprite';
import type { ModelSettings } from './model';
import type { ColorMapping, Filament } from './palette';

const store = createStore('pixel-print', 'library');

export interface SheetRecord {
  id: string;
  name: string;
  created: number;
  image: Blob;
  width: number;
  height: number;
  slice: SliceSettings;
  sample?: boolean;
}

export interface DesignRecord {
  id: string;
  name: string;
  sheetId: string;
  rect: Rect;
  scale: number | 'auto';
  mapping: ColorMapping;
  model: ModelSettings;
  maxColors: number;
  thumb: string;
  updated: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

async function list<T>(prefix: string): Promise<T[]> {
  const all = await entries(store);
  return all.filter(([k]) => String(k).startsWith(prefix)).map(([, v]) => v as T);
}

export const listSheets = () => list<SheetRecord>('sheet:').then((s) => s.sort((a, b) => b.created - a.created));
export const saveSheet = (s: SheetRecord) => set('sheet:' + s.id, s, store);
export const deleteSheet = async (id: string) => {
  await del('sheet:' + id, store);
  for (const d of await listDesigns()) if (d.sheetId === id) await del('design:' + d.id, store);
};

export const listDesigns = () => list<DesignRecord>('design:').then((d) => d.sort((a, b) => b.updated - a.updated));
export const saveDesign = (d: DesignRecord) => set('design:' + d.id, d, store);
export const deleteDesign = (id: string) => del('design:' + id, store);

export const loadFilaments = () => get<Filament[]>('filaments', store);
export const saveFilaments = (f: Filament[]) => set('filaments', f, store);
export const getFlag = (k: string) => get<boolean>('flag:' + k, store);
export const setFlag = (k: string, v: boolean) => set('flag:' + k, v, store);
