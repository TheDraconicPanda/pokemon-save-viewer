import { parseHGSS } from './sav4hgss.js';
import { parsePlatinum } from './sav4pt.js';
import { speciesName, moveName, itemName, abilityName, NATURES, BALLS, GAME_VERSIONS } from './names.js';

// --- Game detection ---
function detectGame(buffer) {
  const u8 = new Uint8Array(buffer);
  const size = u8.length;
  // Strip DSv header for detection
  const raw = size === 0x80200 ? u8.slice(512) : u8;

  // Read game version byte from known offsets
  // HGSS general block game code at 0x00 + 0x1200C area; simpler: try parse and check version
  // Heuristic: check General block game stamp
  // HGSS stamp at 0xF624-0xF627, Pt at 0xC0E8-0xC0EB
  const hgssStamp = new DataView(raw.buffer, raw.byteOffset).getUint32(0xF624, true);
  const ptStamp   = new DataView(raw.buffer, raw.byteOffset).getUint32(0xC0E8, true);

  if (hgssStamp === 0x00000000 || hgssStamp !== 0xFFFFFFFF) {
    // Try HGSS first (more common)
    try { const r = parseHGSS(buffer); if (r.party.length || r.boxes.flat().length) return { game: 'HGSS', result: r }; } catch(e) {}
  }
  try { const r = parsePlatinum(buffer); if (r.party.length || r.boxes.flat().length) return { game: 'Platinum', result: r }; } catch(e) {}
  // Fallback: try HGSS anyway
  return { game: 'HGSS', result: parseHGSS(buffer) };
}

// --- Stat calculation helpers ---
// Display order: HP, ATK, DEF, Sp.Atk, Sp.Def, Speed (in-game order)
// Internal order in ivs/evs objects: hp, atk, def, spe, spa, spd
const STAT_NAMES   = ['HP', 'Attack', 'Defense', 'Sp. Atk', 'Sp. Def', 'Speed'];
// nature mods array from pk4.js is [ATK, DEF, SPE, SPA, SPD]; map to display order
const STAT_NAT_IDX = [-1,   0,        1,          3,         4,         2]; // index into natMods, -1=HP
const STAT_KEYS    = ['hp', 'atk',    'def',      'spa',     'spd',     'spe'];

// --- Render helpers ---
function natureClass(nature) {
  // Nature modifiers: positive stat gets .nat-up, negative gets .nat-down
  // [ATK, DEF, SPE, SPA, SPD] mods indexed by nature
  const mods = [
    [0,0,0,0,0],[1,-1,0,0,0],[1,0,-1,0,0],[1,0,0,-1,0],[1,0,0,0,-1],
    [-1,1,0,0,0],[0,0,0,0,0],[0,1,-1,0,0],[0,1,0,-1,0],[0,1,0,0,-1],
    [-1,0,1,0,0],[0,-1,1,0,0],[0,0,0,0,0],[0,0,1,-1,0],[0,0,1,0,-1],
    [-1,0,0,1,0],[0,-1,0,1,0],[0,0,-1,1,0],[0,0,0,0,0],[0,0,0,1,-1],
    [-1,0,0,0,1],[0,-1,0,0,1],[0,0,-1,0,1],[0,0,0,-1,1],[0,0,0,0,0],
  ];
  return mods[nature] || [0,0,0,0,0];
}

function renderRow(mon, idx) {
  const name = speciesName(mon.species);
  const shiny = mon.isShiny ? '<span class="shiny-star" title="Shiny">★</span>' : '';
  const egg   = mon.isEgg   ? '<span class="egg-tag">EGG</span>' : '';
  const ivSum = mon.ivTotal;
  const level = mon.level || mon.metLevel || '?';
  const natName = NATURES[mon.nature];
  const loc = mon.inParty ? 'Party' : `Box ${mon.boxIndex + 1}`;

  return `<tr class="mon-row" data-idx="${idx}" tabindex="0">
    <td class="td-loc">${loc}</td>
    <td class="td-species">${shiny}${egg}${name}</td>
    <td class="td-level">${level}</td>
    <td class="td-nature">${natName}</td>
    <td class="td-ivtotal ${ivSum >= 186 ? 'high-iv' : ''}">${ivSum}</td>
    <td class="td-ivs">
      <span title="HP">${mon.ivs.hp}</span>/<span title="ATK">${mon.ivs.atk}</span>/<span title="DEF">${mon.ivs.def}</span>/<span title="SPE">${mon.ivs.spe}</span>/<span title="SPA">${mon.ivs.spa}</span>/<span title="SPD">${mon.ivs.spd}</span>
    </td>
    <td class="td-expand"><button class="btn-expand" aria-label="Details">▼</button></td>
  </tr>
  <tr class="detail-row hidden" id="detail-${idx}">
    <td colspan="7">${renderDetail(mon)}</td>
  </tr>`;
}

function renderDetail(mon) {
  const natMods = natureClass(mon.nature);
  // Display order: HP, ATK, DEF, SPA, SPD, SPE — matching in-game stat screen
  const statValues = mon.inParty
    ? [mon.maxHp, mon.stats.atk, mon.stats.def, mon.stats.spa, mon.stats.spd, mon.stats.spe]
    : [null, null, null, null, null, null];

  const ivRows = STAT_NAMES.map((s, i) => {
    const natIdx = STAT_NAT_IDX[i];
    const mod = natIdx < 0 ? 0 : natMods[natIdx];
    const cls = mod > 0 ? 'nat-up' : mod < 0 ? 'nat-down' : '';
    const key = STAT_KEYS[i];
    const iv = mon.ivs[key];
    const ev = mon.evs[key];
    const val = statValues[i] !== null ? statValues[i] : '—';
    const arrow = mod > 0 ? ' ↑' : mod < 0 ? ' ↓' : '';
    return `<tr><td class="stat-lbl ${cls}">${s}<span class="nat-arrow">${arrow}</span></td><td class="stat-val">${val}</td><td>${iv}</td><td>${ev}</td></tr>`;
  }).join('');

  const movesHtml = mon.moves.map((m, i) =>
    m ? `<div class="move-tag">${moveName(m)} <span class="pp">${mon.pp[i]}pp</span></div>` : ''
  ).join('');

  const game = GAME_VERSIONS[mon.gameVersion] || `v${mon.gameVersion}`;
  const ball = BALLS[mon.ball] || `Ball ${mon.ball}`;
  const item = mon.heldItem ? itemName(mon.heldItem) : 'None';
  const ability = abilityName(mon.ability);
  const pkrs = mon.hasPokerus ? (mon.pokerusCured ? '✓ Cured' : '⚡ Active') : '—';
  const otGender = mon.otGender ? '♀' : '♂';
  const displayName = mon.nickname || speciesName(mon.species);

  return `<div class="detail-card">
    <div class="detail-header">
      <strong>${displayName}</strong>
      ${mon.isShiny ? '<span class="shiny-star large">★ Shiny</span>' : ''}
      ${mon.isEgg ? '<span class="egg-tag">EGG</span>' : ''}
    </div>
    <div class="detail-grid">
      <div class="detail-section">
        <h4>Stats</h4>
        <table class="iv-table">
          <thead><tr><th>Stat</th><th>Value</th><th>IV</th><th>EV</th></tr></thead>
          <tbody>${ivRows}</tbody>
        </table>
        <div class="hp-detail detail-type">Hidden Power: <strong>${mon.hpType}</strong> (${mon.hpPower})</div>
      </div>
      <div class="detail-section">
        <h4>Moves</h4>
        <div class="moves-list">${movesHtml || '<em>No moves</em>'}</div>
        <h4>Info</h4>
        <table class="info-table">
          <tr><td>Nature</td><td>${NATURES[mon.nature]}</td></tr>
          <tr><td>Ability</td><td>${ability}</td></tr>
          <tr><td>Held Item</td><td>${item}</td></tr>
          <tr><td>Ball</td><td>${ball}</td></tr>
          <tr><td>Pokerus</td><td>${pkrs}</td></tr>
          <tr><td>Friendship</td><td>${mon.friendship}</td></tr>
          <tr><td>IV Total</td><td>${mon.ivTotal} / 186</td></tr>
          <tr><td>EV Total</td><td>${mon.evTotal} / 510</td></tr>
        </table>
      </div>
      <div class="detail-section">
        <h4>Origin</h4>
        <table class="info-table">
          <tr><td>OT</td><td>${mon.otName} ${otGender}</td></tr>
          <tr><td>TID</td><td>${mon.tid}</td></tr>
          <tr><td>SID</td><td>${mon.sid}</td></tr>
          <tr><td>Game</td><td>${game}</td></tr>
          <tr><td>Met Lv.</td><td>${mon.metLevel}</td></tr>
          ${mon.metDate ? `<tr><td>Met Date</td><td>${mon.metDate}</td></tr>` : ''}
          ${mon.eggDate ? `<tr><td>Egg Date</td><td>${mon.eggDate}</td></tr>` : ''}
          <tr><td>PID</td><td><code>${mon.pid.toString(16).toUpperCase().padStart(8,'0')}</code></td></tr>
        </table>
      </div>
    </div>
  </div>`;
}

// --- Sort/filter state ---
let allMons = [];
let sortKey = 'loc';
let sortAsc = true;
let filterText = '';
let showShinyOnly = false;

function getAllMons(result) {
  const party = result.party.map(m => ({ ...m, _loc: 0 }));
  const boxes  = result.boxes.flatMap((box, bi) => box.map(m => ({ ...m, _loc: bi + 1 })));
  return [...party, ...boxes];
}

function applyFilters(mons) {
  let list = mons;
  if (filterText) {
    const q = filterText.toLowerCase();
    list = list.filter(m =>
      speciesName(m.species).toLowerCase().includes(q) ||
      (m.nickname || '').toLowerCase().includes(q) ||
      NATURES[m.nature].toLowerCase().includes(q)
    );
  }
  if (showShinyOnly) list = list.filter(m => m.isShiny);
  return list;
}

function applySort(mons) {
  const dir = sortAsc ? 1 : -1;
  return [...mons].sort((a, b) => {
    switch (sortKey) {
      case 'species': return dir * (speciesName(a.species).localeCompare(speciesName(b.species)));
      case 'level':   return dir * ((a.level || 0) - (b.level || 0));
      case 'nature':  return dir * (NATURES[a.nature].localeCompare(NATURES[b.nature]));
      case 'ivtotal': return dir * (a.ivTotal - b.ivTotal);
      case 'loc':
      default:        return dir * (a._loc - b._loc || (a.partySlot ?? a.boxSlot ?? 0) - (b.partySlot ?? b.boxSlot ?? 0));
    }
  });
}

function renderTable() {
  const filtered = applySort(applyFilters(allMons));
  const tbody = document.getElementById('mon-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-msg">No Pokémon match your filter.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((m, i) => renderRow(m, i)).join('');

  // Attach expand handlers
  tbody.querySelectorAll('.mon-row').forEach(row => {
    const toggle = () => {
      const idx = row.dataset.idx;
      const detail = document.getElementById(`detail-${idx}`);
      const btn = row.querySelector('.btn-expand');
      const open = !detail.classList.contains('hidden');
      detail.classList.toggle('hidden', open);
      btn.textContent = open ? '▼' : '▲';
      row.classList.toggle('row-open', !open);
    };
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
}

function setSortKey(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = key !== 'ivtotal'; }
  renderTable();
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.toggle('sort-active', th.dataset.sort === sortKey);
    th.classList.toggle('sort-desc', th.dataset.sort === sortKey && !sortAsc);
  });
}

// --- File loading ---
function loadFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { game, result } = detectGame(e.target.result);
      document.getElementById('game-badge').textContent = game;
      document.getElementById('mon-count').textContent = `${result.totalPokemon} Pokémon`;
      document.getElementById('upload-area').classList.add('hidden');
      document.getElementById('viewer').classList.remove('hidden');
      allMons = getAllMons(result);
      renderTable();
    } catch (err) {
      showError(`Could not parse save file: ${err.message}`);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', () => {
  // File input
  document.getElementById('file-input').addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  // Drag and drop (desktop)
  const dropZone = document.getElementById('upload-area');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  });

  // Sort headers
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => setSortKey(th.dataset.sort));
  });

  // Filter input
  document.getElementById('filter-input').addEventListener('input', e => {
    filterText = e.target.value.trim();
    renderTable();
  });

  // Shiny filter
  document.getElementById('shiny-toggle').addEventListener('change', e => {
    showShinyOnly = e.target.checked;
    renderTable();
  });

  // Load new file button
  document.getElementById('btn-new-file').addEventListener('click', () => {
    allMons = [];
    document.getElementById('upload-area').classList.remove('hidden');
    document.getElementById('viewer').classList.add('hidden');
    document.getElementById('file-input').value = '';
  });
});
