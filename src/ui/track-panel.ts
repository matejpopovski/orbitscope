import { apsides } from '../catalog/classify';
import type { Telemetry } from '../engine/selection';
import type { Pass } from '../passes/predictor';
import type { CatalogEntry } from '../catalog/snapshot';
import { formatCompass, formatDuration, formatLatLon, formatPassTime } from './format';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const FIELDS = [
  ['alt', 'Altitude'],
  ['speed', 'Velocity'],
  ['position', 'Subpoint'],
  ['light', 'Illumination'],
  ['perigee', 'Perigee'],
  ['apogee', 'Apogee'],
  ['incl', 'Inclination'],
  ['period', 'Period'],
  ['age', 'Element age'],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

export class TrackPanel {
  private readonly panel = byId('track');
  private readonly name = byId('track-name');
  private readonly ids = byId('track-ids');
  private readonly look = byId('look');
  private readonly passBody = byId('passes').querySelector('tbody') as HTMLElement;
  private readonly passStatus = byId('pass-status');
  private readonly values = new Map<FieldKey, HTMLElement>();

  constructor() {
    const list = byId('telemetry');
    for (const [key, label] of FIELDS) {
      const group = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = '-';
      group.append(term, value);
      list.append(group);
      this.values.set(key, value);
    }
  }

  private set(key: FieldKey, text: string): void {
    const element = this.values.get(key) as HTMLElement;
    if (element.textContent !== text) element.textContent = text;
  }

  show(entry: CatalogEntry, periodMin: number): void {
    this.panel.hidden = false;
    this.name.textContent = entry.OBJECT_NAME;
    this.ids.textContent = `NORAD ${entry.NORAD_CAT_ID}  COSPAR ${entry.OBJECT_ID}`;
    const { apogeeKm, perigeeKm } = apsides(entry.MEAN_MOTION, entry.ECCENTRICITY);
    this.set('perigee', `${perigeeKm.toFixed(0)} km`);
    this.set('apogee', `${apogeeKm.toFixed(0)} km`);
    this.set('incl', `${entry.INCLINATION.toFixed(2)} deg`);
    this.set(
      'period',
      periodMin >= 120 ? `${(periodMin / 60).toFixed(2)} h` : `${periodMin.toFixed(1)} min`,
    );
    this.passBody.replaceChildren();
    this.passStatus.textContent = 'Computing passes';
  }

  hide(): void {
    this.panel.hidden = true;
  }

  update(telemetry: Telemetry | null, epochMs: number, simMs: number): void {
    const ageDays = (simMs - epochMs) / 86_400_000;
    this.set('age', `${ageDays.toFixed(1)} d`);
    if (!telemetry) {
      this.set('alt', 'no solution');
      this.look.textContent = 'Propagation failed at this time';
      return;
    }
    const { geodetic, speedKmS, sunlit, look } = telemetry;
    this.set('alt', `${geodetic.altKm.toFixed(1)} km`);
    this.set('speed', `${speedKmS.toFixed(3)} km/s`);
    this.set('position', formatLatLon(geodetic.latDeg, geodetic.lonDeg));
    this.set('light', sunlit ? 'Sunlit' : 'Eclipsed');
    const text =
      `Az ${look.azimuthDeg.toFixed(1)}  El ${look.elevationDeg.toFixed(1)}  ` +
      `Range ${look.rangeKm.toFixed(0)} km`;
    if (this.look.textContent !== text) this.look.textContent = text;
  }

  showPasses(passes: readonly Pass[], elapsedMs: number, horizonHours: number): void {
    this.passBody.replaceChildren(
      ...passes.map((pass) => {
        const row = document.createElement('tr');
        const cells = [
          `${pass.startsInProgress ? 'up now' : formatPassTime(pass.aosMs)}`,
          `${pass.maxElevationDeg.toFixed(0)} ${formatCompass(pass.tcaAzimuthDeg)}`,
          pass.endsInProgress
            ? `>${formatDuration(pass.losMs - pass.aosMs)}`
            : formatDuration(pass.losMs - pass.aosMs),
          pass.visible ? 'yes' : '',
        ];
        cells.forEach((text, i) => {
          const cell = document.createElement('td');
          cell.textContent = text;
          if (i === 3 && pass.visible) cell.className = 'visible';
          row.append(cell);
        });
        return row;
      }),
    );
    this.passStatus.textContent =
      passes.length === 0
        ? `No passes above the mask in ${horizonHours} h`
        : `Solved in ${elapsedMs.toFixed(1)} ms, geometric horizon`;
  }
}
