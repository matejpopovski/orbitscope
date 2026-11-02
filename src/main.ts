import './style.css';
import { App, parseOptions } from './app';
import { scaleCatalog } from './catalog/scale';
import { loadCatalog } from './catalog/snapshot';
import { PropagationPool } from './engine/pool';

const status = document.getElementById('status') as HTMLElement;

async function main(): Promise<void> {
  const options = parseOptions(window.location.search, Date.now());
  const baseUrl = import.meta.env.BASE_URL;

  const { manifest, entries } = await loadCatalog(baseUrl);
  const catalog = scaleCatalog(entries, options.scale);

  status.textContent = `Initialising ${catalog.length.toLocaleString('en-US')} orbits`;
  const pool = new PropagationPool(catalog, options.workers);
  await pool.ready;

  new App(catalog, pool, options, manifest, baseUrl).start();
  status.hidden = true;
}

main().catch((error: unknown) => {
  status.classList.add('error');
  status.textContent = `orbitscope could not start: ${error instanceof Error ? error.message : String(error)}`;
});
