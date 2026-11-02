import { CATEGORIES } from '../catalog/classify';
import type { CatalogEntry } from '../catalog/snapshot';

export const PALETTE: readonly string[] = [
  '#4d9fff',
  '#8a8dff',
  '#4be08a',
  '#dfe8f1',
  '#f6cb4b',
  '#ff8f40',
  '#ff5f93',
];

const MAX_RESULTS = 8;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export function renderCategories(
  counts: readonly number[],
  onChange: (mask: number) => void,
): void {
  const list = byId('categories');
  let mask = (1 << CATEGORIES.length) - 1;
  CATEGORIES.forEach((category, index) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'true');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = PALETTE[index] as string;
    const label = document.createElement('span');
    label.textContent = category.label;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = (counts[index] as number).toLocaleString('en-US');

    button.append(swatch, label, count);
    button.addEventListener('click', () => {
      mask ^= 1 << index;
      button.setAttribute('aria-pressed', String(((mask >> index) & 1) === 1));
      onChange(mask);
    });
    row.append(button);
    list.append(row);
  });
}

/** Case-insensitive search over name, catalog number and international designator. */
export function searchCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  limit = MAX_RESULTS,
): number[] {
  const needle = query.trim().toUpperCase();
  if (needle.length === 0) return [];
  const hits: number[] = [];
  const exact = /^\d+$/.test(needle) ? Number(needle) : null;
  for (let i = 0; i < entries.length && hits.length < limit; i += 1) {
    const entry = entries[i] as CatalogEntry;
    if (
      entry.NORAD_CAT_ID === exact ||
      entry.OBJECT_NAME.includes(needle) ||
      entry.OBJECT_ID.includes(needle)
    ) {
      hits.push(i);
    }
  }
  return hits;
}

export function wireSearch(
  entries: readonly CatalogEntry[],
  select: (index: number) => void,
): void {
  const input = byId<HTMLInputElement>('search');
  const results = byId('results');

  const render = (): void => {
    const hits = searchCatalog(entries, input.value);
    results.replaceChildren(
      ...hits.map((index) => {
        const entry = entries[index] as CatalogEntry;
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entry.OBJECT_NAME;
        button.title = `${entry.OBJECT_NAME}, NORAD ${entry.NORAD_CAT_ID}`;
        button.addEventListener('click', () => select(index));
        row.append(button);
        return row;
      }),
    );
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = searchCatalog(entries, input.value, 1)[0];
    if (first !== undefined) select(first);
  });
}
