import { MAGNET_SIZES, type MagnetReport, type MagnetSettings } from '../lib/magnets';
import { NumberField, Segmented, Toggle } from './fields';

interface Props {
  id: string;
  label: string;
  value: MagnetSettings;
  onChange: (m: MagnetSettings) => void;
  report: MagnetReport | null;
  maxCount?: number;
}

export default function MagnetControls({ id, label, value, onChange, report, maxCount = 4 }: Props) {
  const set = (patch: Partial<MagnetSettings>) => onChange({ ...value, ...patch });
  return (
    <div className="magnets">
      <Toggle id={`${id}-on`} label={label} checked={value.enabled} onChange={(enabled) => set({ enabled })} />
      {value.enabled && (
        <>
          <div className="field">
            <span className="field-label">Magnet size (diameter × thickness)</span>
            <div className="chips">
              {MAGNET_SIZES.map(([d, t]) => (
                <button
                  key={`${d}x${t}`}
                  className={'chip mono' + (value.diameter === d && value.thickness === t ? ' on' : '')}
                  onClick={() => set({ diameter: d, thickness: t })}
                >
                  {d}×{t}
                </button>
              ))}
            </div>
          </div>
          <div className="fields two">
            <NumberField id={`${id}-d`} label="Diameter" unit="mm" step={0.5} min={1} max={30} value={value.diameter} onChange={(diameter) => set({ diameter })} />
            <NumberField id={`${id}-t`} label="Thickness" unit="mm" step={0.5} min={0.5} max={10} value={value.thickness} onChange={(thickness) => set({ thickness })} />
            <NumberField
              id={`${id}-c`}
              label="Fit clearance"
              unit="mm"
              step={0.05}
              min={0}
              max={1}
              value={value.clearance}
              onChange={(clearance) => set({ clearance })}
              hint="Added to the pocket diameter. 0.1–0.2 mm for a press fit, more if you glue them in"
            />
          </div>
          <Segmented
            label="How many"
            value={String(value.count)}
            options={Array.from({ length: maxCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            onChange={(c) => set({ count: +c })}
          />
          <Segmented
            label="Pocket"
            value={value.hidden ? 'hidden' : 'open'}
            options={[
              { value: 'open', label: 'Open, glue in after', title: 'Pocket opens on the bottom of the print' },
              { value: 'hidden', label: 'Sealed inside', title: 'Pause the print and drop the magnets in' },
            ]}
            onChange={(v) => set({ hidden: v === 'hidden' })}
          />
          {report && (
            <div className="magnet-report">
              {report.placed.length > 0 && (
                <p className="ok">
                  {report.placed.length} pocket{report.placed.length > 1 ? 's' : ''} for {value.diameter}×{value.thickness} mm magnets.
                  {report.pauseZ !== null && (
                    <>
                      {' '}
                      Pause the print at <strong className="mono">Z {report.pauseZ.toFixed(2)} mm</strong> to drop {report.placed.length > 1 ? 'them' : 'it'} in.
                    </>
                  )}
                </p>
              )}
              {report.warnings.map((w) => (
                <p key={w} className="warn">
                  {w}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
