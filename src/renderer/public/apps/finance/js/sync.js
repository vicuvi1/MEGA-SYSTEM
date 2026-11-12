// Merging two copies of your data (this device and the copy in Google
// Drive). Every record carries updatedAt; for each record the newest copy
// wins. Deletions are remembered (state.deleted), so a record deleted on one
// device is not brought back by another. Device-only things (PIN, rates,
// theme, log view, backups info) never travel.

import { normalizeState, SCHEMA_VERSION } from './model.js';

const LOCAL_SETTINGS = ['theme', 'themeInLife', 'themeMotion', 'logView'];
const SCALARS = (s) => Object.keys(s).filter((k) => !['jars', 'accounts', 'categories', 'subcats', 'subMemory', 'updatedAt', ...LOCAL_SETTINGS].includes(k));

// What goes to Drive.
export function toCloud(state, deviceId, now = Date.now()) {
  const settings = { ...state.settings };
  for (const k of LOCAL_SETTINGS) delete settings[k];
  return {
    app: 'finance-helper',
    schema: SCHEMA_VERSION,
    savedAt: now,
    deviceId,
    data: { settings, tx: state.tx, people: state.people, recurring: state.recurring || [], invoices: state.invoices || [], netWorth: state.netWorth || [], goals: state.goals || [], goalAllocations: state.goalAllocations || [], deleted: state.deleted, ...(sharedRates(state.rates) ? { lastRates: sharedRates(state.rates) } : {}) },
  };
}

// The latest known exchange rates travel too (once a day at most), so a
// device whose live rate download fails still prices USD and EUR: the fiat
// rates (units per 1 USD) and the day they are from.
const FIAT_CODES = ['MDL', 'USD', 'EUR', 'RON', 'GBP', 'UAH', 'CHF', 'PLN', 'TRY', 'CAD'];
export function sharedRates(rates) {
  if (!rates?.usd || !rates.fetchedAt) return null;
  const usd = {};
  for (const c of FIAT_CODES) if (rates.usd[c] > 0) usd[c] = Math.round(rates.usd[c] * 1e4) / 1e4;
  if (!usd.MDL) return null;
  const d = new Date(rates.fetchedAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, usd };
}

// Rates from another device, when they are newer than this device's.
function withRates(localRates, remote) {
  const mine = sharedRates(localRates);
  if (!remote?.usd?.MDL || !/^\d{4}-\d{2}-\d{2}$/.test(remote.date || '') || (mine && mine.date >= remote.date)) return localRates;
  return { ...(localRates || {}), usd: { ...(localRates?.usd || {}), ...remote.usd }, crypto: localRates?.crypto || {}, history: localRates?.history || {}, fetchedAt: Date.parse(`${remote.date}T12:00:00`), synced: true };
}

function mergeList(a = [], b = [], deleted) {
  const byId = new Map();
  for (const x of a) byId.set(x.id, x);
  for (const x of b) {
    const mine = byId.get(x.id);
    if (!mine || (x.updatedAt || 0) > (mine.updatedAt || 0)) byId.set(x.id, x);
  }
  const out = [];
  for (const [id, x] of byId) {
    const gone = deleted[id];
    if (gone && gone >= (x.updatedAt || 0)) continue;
    out.push(x);
  }
  return out;
}

// Same data = same fingerprint, whatever order the fields were written in.
const fingerprint = (data) => JSON.stringify(data, (k, v) => {
  if (k === 'savedAt') return undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]]));
  return v;
});

// This page has a change still waiting to be written (store.js saveSoon) and
// the stored copy changed meanwhile (Life System's sync, its Telegram inbox):
// both together, the same merge as above (newest copy of each record wins,
// deletions stick). Device-only parts stay this page's.
export function mergeLocal(local, stored) {
  return mergeStates(local, toCloud(stored, '')).state;
}

// Merge `remote` (the Drive file, or null) into `local`. Returns the merged
// state and whether this device and/or Drive need the new version.
export function mergeStates(local, remote) {
  if (!remote) return { state: local, pushNeeded: true, pullChanged: false };
  if (remote.app !== 'finance-helper' || !remote.data) throw new Error('The file in Google Drive is not Finance Helper data.');
  if ((remote.schema || 1) > SCHEMA_VERSION) throw new Error('Your data in Google Drive was saved by a newer version of the app. Update this app first (Settings → About & updates).');

  const r = normalizeState({ ...remote.data, version: remote.schema });
  const deleted = { ...local.deleted };
  for (const [id, ts] of Object.entries(r.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);

  const newer = (r.settings.updatedAt || 0) > (local.settings.updatedAt || 0);
  const scalarsFrom = newer ? r.settings : local.settings;
  const settings = { ...local.settings };
  for (const k of SCALARS(scalarsFrom)) settings[k] = scalarsFrom[k];
  settings.updatedAt = Math.max(local.settings.updatedAt || 0, r.settings.updatedAt || 0);
  settings.accounts = mergeList(local.settings.accounts, r.settings.accounts, deleted);
  // The card order you set on one device is the order everywhere.
  settings.accounts.sort((a, b) => (Number.isFinite(a.order) ? a.order : 1e6) - (Number.isFinite(b.order) ? b.order : 1e6));
  settings.categories = mergeList(local.settings.categories, r.settings.categories, deleted);
  settings.jars = mergeList(local.settings.jars, r.settings.jars, deleted);
  settings.subcats = mergeList(local.settings.subcats, r.settings.subcats, deleted);
  // Learned merchants: both sides, the newer settings winning on the same merchant.
  settings.subMemory = newer ? { ...(local.settings.subMemory || {}), ...(r.settings.subMemory || {}) } : { ...(r.settings.subMemory || {}), ...(local.settings.subMemory || {}) };

  const merged = {
    ...local,
    settings,
    tx: mergeList(local.tx, r.tx, deleted),
    people: mergeList(local.people, r.people, deleted),
    recurring: mergeList(local.recurring, r.recurring, deleted),
    invoices: mergeList(local.invoices, r.invoices, deleted),
    netWorth: mergeList(local.netWorth, r.netWorth, deleted),
    goals: mergeList(local.goals, r.goals, deleted),
    goalAllocations: mergeList(local.goalAllocations, r.goalAllocations, deleted),
    deleted,
    rates: withRates(local.rates, remote.data.lastRates),
  };
  const localData = toCloud(local, '').data;
  const mergedData = toCloud(merged, '').data;
  return {
    state: merged,
    pullChanged: fingerprint(localData) !== fingerprint(mergedData),
    pushNeeded: fingerprint(toCloud({ ...r, settings: { ...r.settings } }, '').data) !== fingerprint(mergedData),
  };
}
