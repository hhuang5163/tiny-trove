/* Tiny Trove — a blind box shelf that lives on your device.
   Everything you mark (owned, dates, notes, your own photos) is stored in this
   browser's IndexedDB on the device. Nothing is ever sent anywhere. */
(function () {
  'use strict';

  // ---------- catalog ----------
  // Built-in catalogs (data/*.js) plus collections, series and figures you made yourself.
  const BASE = (window.TROVE_CATALOGS || []);
  let CATALOGS = [];
  const BY_COLL = {};
  const custom = new Map();     // your own collections / series / figures, stored on this phone
  const byCreated = (a, b) => (a.created || 0) - (b.created || 0);
  const wObj = w => (typeof w === 'number' && isFinite(w)) ? { avg: w, n: 0, min: null, max: null, mine: true } : null;
  function customFigure(r) {
    return { id: r.series + '/' + r.id, slug: r.id, en: r.en, ja: r.ja || '', jaUnsure: false, secret: !!r.secret,
      box: wObj(r.boxW), bare: wObj(r.bareW), tips: r.tips || '', custom: true, rec: r.key };
  }
  function buildCatalogs() {
    for (const k of Object.keys(BY_COLL)) delete BY_COLL[k];
    const recs = [...custom.values()];
    const cols = BASE.map(cat => ({ ...cat, series: cat.series.map(x => ({ ...x, figures: x.figures.map(f => ({ ...f })) })) }));
    recs.filter(r => r.type === 'collection').sort(byCreated)
      .forEach(r => cols.push({ collection: r.id, name: r.name, custom: true, rec: r.key, series: [] }));
    const byId = {};
    cols.forEach(c => { byId[c.collection] = c; });
    recs.filter(r => r.type === 'series').sort(byCreated).forEach(r => {
      const c = byId[r.coll];
      if (c) c.series.push({ slug: r.id, name: r.name, custom: true, rec: r.key, booklet: null, figures: [] });
    });
    recs.filter(r => r.type === 'figure').sort(byCreated).forEach(r => {
      const c = byId[r.coll];
      const sr = c && c.series.find(x => x.slug === r.series);
      if (sr) sr.figures.push(customFigure(r));
    });
    for (const cat of cols) {
      const series = {};
      cat.series.forEach((sr, si) => {
        sr.order = si;
        series[sr.slug] = sr;
        sr.figures.forEach((f, fi) => {
          f.order = fi;
          f.series = sr;
          f.key = cat.collection + ':' + f.id;
          f.boxAvg = f.box ? f.box.avg : null;
        });
      });
      cat.bySlug = series;
      cat.allFigures = cat.series.flatMap(x => x.figures);
      BY_COLL[cat.collection] = cat;
    }
    CATALOGS = cols;
  }
  buildCatalogs();

  // ---------- storage (IndexedDB) ----------
  const DB_NAME = 'tiny-trove', DB_VER = 2;
  let db;
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('custom')) d.createObjectStore('custom', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const getAll = store => new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  const put = (store, val) => tx(store, 'readwrite', s => { s.put(val); });
  const del = (store, key) => tx(store, 'readwrite', s => { s.delete(key); });
  const clear = store => tx(store, 'readwrite', s => { s.clear(); });

  const items = new Map();      // key -> {key, have, date, qty, notes, updated}
  const myPhotos = new Map();   // key -> object URL of a photo added in the app
  const settings = { theme: 'auto', lastBackup: null };

  async function loadAll() {
    db = await openDB();
    for (const it of await getAll('items')) items.set(it.key, it);
    for (const p of await getAll('photos')) myPhotos.set(p.key, URL.createObjectURL(p.blob));
    for (const s of await getAll('settings')) settings[s.k] = s.v;
    for (const r of await getAll('custom')) custom.set(r.key, r);
    buildCatalogs();
  }
  const saveSetting = (k, v) => { settings[k] = v; return put('settings', { k, v }); };
  const item = key => items.get(key) || { key, have: false, date: '', qty: 1, notes: '' };
  const has = f => !!(items.get(f.key) || {}).have;
  async function saveItem(it) {
    it.updated = Date.now();
    items.set(it.key, it);
    await put('items', it);
  }

  // Ask the browser to protect this storage from automatic cleanup.
  let persisted = null;
  async function askPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        persisted = await navigator.storage.persisted();
        if (!persisted) persisted = await navigator.storage.persist();
      }
    } catch (e) { persisted = null; }
  }

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = n => (n == null ? '—' : Number(n).toFixed(2));
  const $ = sel => document.querySelector(sel);
  const app = () => document.getElementById('app');
  const today = () => new Date().toISOString().slice(0, 10);
  const niceDate = d => {
    if (!d) return '';
    const dt = new Date(d + 'T12:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const STAR = (size, cls) => `<svg class="${cls || 'star'}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="var(--seal)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round" aria-label="secret" role="img"><path d="M12 2.5l2.8 6 6.4.6-4.8 4.3 1.4 6.4L12 16.6 6.2 19.8l1.4-6.4L2.8 9.1l6.4-.6z"/></svg>`;
  const sketch = (f, size, stroke) => `<svg class="pose" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke="var(--ink)" stroke-width="${stroke || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${window.TroveSketch(f.en)}"/></svg>`;
  function tally(n) {
    if (!n) return '<span class="tiny sub">no reports yet</span>';
    let d = '', x = 2;
    for (let g = 0; g < Math.ceil(n / 5); g++) {
      const k = Math.min(5, n - g * 5), start = x;
      for (let i = 0; i < Math.min(4, k); i++) { d += `M${x} 2 V14 `; x += 4; }
      if (k === 5) d += `M${start - 2} 12 L${x - 2} 4 `;
      x += 5;
    }
    return `<svg width="${x}" height="16" viewBox="0 0 ${x} 16" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="${d}"/></svg>`;
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------- photos ----------
  // 1) a photo you added in the app (stays on this phone), else
  // 2) a photo in the site's photos/ folder: photos/<collection>/<series>/<figure>.jpg|png|webp, else
  // 3) a generic sketch.
  const EXTS = ['jpg', 'png', 'webp', 'jpeg'];
  const folderMissing = new Set();
  const folderFound = new Map();
  const folderBase = (coll, f) => `photos/${coll}/${f.id}`;
  function photoTag(coll, f, cls) {
    const mine = myPhotos.get(f.key);
    if (mine) return `<img class="${cls}" src="${mine}" alt="">`;
    const base = folderBase(coll, f);
    if (folderMissing.has(base)) return '';
    const ext = folderFound.get(base) || EXTS[0];
    return `<img class="${cls}" src="${base}.${ext}" data-base="${base}" data-ext="${ext}" alt="" onerror="TT.imgFail(this)" onload="TT.imgOk(this)">`;
  }
  window.TT = {
    imgFail(img) {
      const base = img.dataset.base; if (!base) { img.remove(); return; }
      const i = EXTS.indexOf(img.dataset.ext);
      if (!folderFound.has(base) && i < EXTS.length - 1) { img.dataset.ext = EXTS[i + 1]; img.src = `${base}.${EXTS[i + 1]}`; return; }
      folderMissing.add(base); img.remove();
    },
    imgOk(img) {
      if (img.dataset.base) folderFound.set(img.dataset.base, img.dataset.ext);
      const sk = img.parentElement && img.parentElement.querySelector('svg.pose');
      if (sk) sk.style.visibility = 'hidden';
    }
  };
  function shrinkImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const sc = Math.min(1, maxSide / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * sc); cv.height = Math.round(im.height * sc);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('photo')), 'image/jpeg', 0.85);
      };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('photo')); };
      im.src = url;
    });
  }

  // ---------- theme ----------
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme(coll) {
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && mq && mq.matches);
    document.body.classList.toggle('dark', !!dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.className = document.body.className.replace(/\bskin-\S+/g, '').trim();
    if (coll) document.body.classList.add('skin-' + coll);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body).getPropertyValue('--paper').trim() || '#F6F3EC';
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', () => route());

  // ---------- view state (kept while the app is open) ----------
  const view = { tab: 'series', q: '', show: 'all', sortSeries: 'release', sortFigs: 'name', seriesShow: 'all', seriesSort: 'release' };

  // ---------- pages ----------
  function homePage() {
    const recent = [...items.values()].filter(i => i.have).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated || 0) - (a.updated || 0)).slice(0, 3);
    const tags = recent.map((it, i) => {
      const [coll, id] = it.key.split(':');
      const cat = BY_COLL[coll]; if (!cat) return '';
      const f = cat.allFigures.find(x => x.id === id); if (!f) return '';
      return `<a class="tag-card bg-${i % 4} tilt-${i * 2 % 8}" href="#/c/${coll}/f/${f.id}">
        <span style="position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:6px">${sketch(f, 40, 1.7)}${photoTag(coll, f, 'tag-photo" style="position:absolute;inset:0;width:100%;height:100%')}</span>
        <span class="nm">${esc(f.en)}</span><span class="tiny sub">${esc(niceDate(it.date) || f.series.name)}</span>
        ${f.secret ? STAR(20) : ''}</a>`;
    }).join('');
    const boxes = CATALOGS.map(cat => {
      const owned = cat.allFigures.filter(has).length;
      const sec = cat.allFigures.filter(f => f.secret && has(f)).length;
      return `<a class="coll-box" href="#/c/${cat.collection}">
        <span class="lid"><i></i></span>
        <span class="body"><span class="name">${esc(cat.name)}</span><span class="num">${owned} / ${cat.allFigures.length}</span></span>
        ${sec ? `<span class="sticker">${sec} secret${sec > 1 ? 's' : ''}</span>` : ''}</a>`;
    }).join('');
    const lb = settings.lastBackup ? niceDate(settings.lastBackup.slice(0, 10)) : null;
    return `<div class="wrap">
      <div class="row" style="align-items:flex-end;margin-top:8px">
        <h1 class="big">Tiny Trove</h1>${STAR(22, 'hdr-star" style="margin-bottom:8px;transform:rotate(12deg)')}
      </div>
      <div class="bookcase"><div class="bookcase-inner">
        <div class="bookcase-row">${boxes}<button class="add-box" data-act="newColl" aria-label="Make a new collection"><span aria-hidden="true">+</span></button></div>
        <div class="plank"></div>
      </div></div>
      <h2 class="hand-h">just opened</h2>
      ${tags ? `<div class="tags">${tags}</div>` : `<p class="empty-note">nothing yet! open a box and tick it off.</p>`}
      <div class="note">
        <p class="hand-p">last backup: <b>${lb ? esc(lb) : 'never'}</b>${lb ? '' : '!'} save a copy to iCloud Drive or Files just in case.</p>
        <div class="btn-row">
          <button class="btn fill" data-act="export">Save backup</button>
          <button class="btn" data-act="import">Load backup</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" class="visually-hidden" tabindex="-1">
      </div>
      <div class="settings">
        <label class="field" style="height:40px">look
          <select id="themeSel" aria-label="Light or dark look">
            <option value="auto"${settings.theme === 'auto' ? ' selected' : ''}>match system</option>
            <option value="light"${settings.theme === 'light' ? ' selected' : ''}>light</option>
            <option value="dark"${settings.theme === 'dark' ? ' selected' : ''}>dark</option>
          </select>
        </label>
      </div>
      <p class="foot">${persisted === true ? 'Storage is marked to be kept on this device. ' : ''}Deleting the Home Screen icon deletes your shelf, so save a backup first.</p>
    </div>`;
  }

  function seriesMatches(s, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.figures.some(f => f.en.toLowerCase().includes(q) || (f.ja && f.ja.includes(q)));
  }
  function figMatches(f, q) {
    if (!q) return true;
    const ql = q.toLowerCase();
    return f.en.toLowerCase().includes(ql) || (f.ja && f.ja.includes(q)) || f.series.name.toLowerCase().includes(ql);
  }
  function filterFig(f, show) {
    if (show === 'opened') return has(f);
    if (show === 'sealed') return !has(f);
    if (show === 'secrets') return f.secret;
    return true;
  }
  const openedDate = f => (items.get(f.key) || {}).date || '';
  function sortFigs(list, how) {
    const l = list.slice();
    const w = f => (f.boxAvg == null ? Infinity : f.boxAvg);
    if (how === 'name') l.sort((a, b) => a.en.localeCompare(b.en));
    else if (how === 'lightest') l.sort((a, b) => w(a) - w(b));
    else if (how === 'heaviest') l.sort((a, b) => (b.boxAvg ?? -1) - (a.boxAvg ?? -1));
    else if (how === 'newest') l.sort((a, b) => openedDate(b).localeCompare(openedDate(a)) || (has(b) - has(a)));
    else l.sort((a, b) => a.series.order - b.series.order || a.order - b.order);
    return l;
  }
  function chips(name, opts, current) {
    return `<fieldset class="filters"><legend class="visually-hidden">Show</legend>${opts.map(([v, label]) =>
      `<label class="chip${current === v ? ' on' : ''}"><input type="radio" name="${name}" value="${v}"${current === v ? ' checked' : ''}>${esc(label)}</label>`).join('')}</fieldset>`;
  }

  function collectionPage(cat) {
    const owned = cat.allFigures.filter(has).length;
    const secrets = cat.allFigures.filter(f => f.secret);
    const secOwned = secrets.filter(has).length;
    const isSeries = view.tab === 'series';
    const sortOpts = isSeries
      ? [['release', 'release order'], ['most', 'most opened'], ['name', 'name']]
      : [['name', 'name'], ['release', 'by series'], ['lightest', 'lightest'], ['heaviest', 'heaviest'], ['newest', 'newest opened']];
    const cur = isSeries ? view.sortSeries : view.sortFigs;
    const showOpts = isSeries
      ? [['all', 'all'], ['opened', 'opened'], ['sealed', 'still sealed'], ['secrets', '★ secrets'], ['done', 'finished']]
      : [['all', 'all'], ['opened', 'opened'], ['sealed', 'still sealed'], ['secrets', '★ secrets']];
    return `<div class="wrap">
      <a class="back" href="#/">‹ my trove</a>
      ${cat.custom ? `<button class="edit-btn" data-act="editColl">edit collection</button>` : ''}
      <div class="title-row"><h1 class="big">${esc(cat.name)}</h1>
        <span class="count">${owned} / ${cat.allFigures.length} · <span class="star-pill">★ ${secOwned} / ${secrets.length}</span></span></div>
      <div class="tabs" role="tablist" aria-label="View">
        <button class="tab" role="tab" aria-selected="${isSeries}" data-tab="series">by series</button>
        <button class="tab" role="tab" aria-selected="${!isSeries}" data-tab="all">every figure</button>
      </div>
      <div class="panel">
        <div class="tools">
          <label class="field" style="flex:1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>
            <input type="search" id="q" aria-label="Find a series or figure, in English or Japanese" placeholder="find… (English or カタカナ)" value="${esc(view.q)}" autocomplete="off"></label>
          <label class="field">sort <select id="sortSel" aria-label="Sort">${sortOpts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        ${chips('show', showOpts, view.show === 'done' && !isSeries ? 'all' : view.show)}
        <div id="list">${isSeries ? seriesList(cat) : figureGrid(cat)}</div>
      </div>
      ${cat.sourceUrl ? `<p class="foot">Weights and tips from the <a href="${esc(cat.sourceUrl)}" target="_blank" rel="noopener">${esc(cat.sourceName || 'community masterlist')}</a>.</p>` : ''}
    </div>`;
  }

  function seriesList(cat) {
    let list = cat.series.filter(s => seriesMatches(s, view.q));
    const opened = s => s.figures.filter(has).length;
    if (view.show === 'opened') list = list.filter(s => opened(s) > 0);
    if (view.show === 'sealed') list = list.filter(s => opened(s) < s.figures.length);
    if (view.show === 'secrets') list = list.filter(s => s.figures.some(f => f.secret && has(f)));
    if (view.show === 'done') list = list.filter(s => opened(s) === s.figures.length);
    if (view.sortSeries === 'most') list.sort((a, b) => opened(b) / b.figures.length - opened(a) / a.figures.length);
    if (view.sortSeries === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    const addShelf = `<button class="add-shelf" data-act="newSeries"><span class="plus" aria-hidden="true">+</span> new series</button>`;
    if (!list.length) return (cat.series.length ? `<p class="empty-note" style="margin-top:14px">no series match.</p>` : `<p class="empty-note" style="margin-top:14px">no series yet. add the first one!</p>`) + `<div class="shelves">${addShelf}</div>`;
    return `<div class="shelves">${list.map((s, si) => `
      <a class="shelf" href="#/c/${cat.collection}/s/${s.slug}">
        <div class="shelf-head"><span class="shelf-name"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--ink)" stroke-width="2"/></svg>${esc(s.name)}</span>
          <span class="small sub" style="font-weight:800">${opened(s)}/${s.figures.length} opened ›</span></div>
        <div class="shelf-boxes">${s.figures.map((f, i) => {
          const o = has(f);
          return `<div class="mini ${o ? 'bg-' + ((i + si) % 4) : ''} tilt-${(i + si) % 8}" title="${esc(f.en)}">
            ${o ? sketch(f, 26, 2.1) + photoTag(cat.collection, f, 'mini-photo" style="position:absolute;left:2px;right:2px;bottom:2px;top:10px;width:auto;height:auto;margin:0') : '<span class="q">?</span>'}
            ${f.secret ? STAR(15) : ''}</div>`;
        }).join('')}</div>
        <div class="plank-sm"></div>
      </a>`).join('')}${addShelf}</div>`;
  }

  function bigShelf(cat, figs, showSeries, addable) {
    if (!figs.length && !addable) return `<p class="empty-note" style="margin-top:14px">nothing here.</p>`;
    const cells = addable ? figs.concat([null]) : figs;
    const rows = [];
    for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
    return `<div class="big-shelf"><div class="big-shelf-inner">${rows.map((row, ri) => `
      <div class="big-row">${row.map((f, i) => {
        if (!f) return `<button class="big-box add" data-act="newFig" aria-label="Add a figure to this series"><span class="boxart add-art"><span aria-hidden="true">+</span></span><span class="nm">add figure</span></button>`;
        const o = has(f);
        const n = ri * 3 + i;
        return `<a class="big-box" href="#/c/${cat.collection}/f/${f.id}" aria-label="${esc(f.en)}${f.secret ? ', secret' : ''}${o ? ', opened' : ', still hunting'}">
          <span class="boxart ${o ? 'bg-' + (n % 4) : 'sealed'} tilt-${n % 8}" style="${o ? '' : 'opacity:.8'}">
            ${sketch(f, 52, 1.8)}${photoTag(cat.collection, f, 'big-photo" style="position:absolute;left:3px;right:3px;top:16px;bottom:3px;width:auto;height:auto;margin:0;border-radius:3px')}
            ${f.secret ? STAR(20) : ''}
          </span>
          <span class="nm">${esc(f.en)}</span>
          ${f.ja ? `<span class="ja">${esc(f.ja)}</span>` : ''}
          <span class="wt">${showSeries ? esc(f.series.name) : (f.boxAvg != null ? fmt(f.boxAvg) + ' g' : 'no weight yet')}</span>
        </a>`;
      }).join('')}</div><div class="big-plank"></div>`).join('')}
    </div></div>`;
  }

  function figureGrid(cat) {
    const figs = sortFigs(cat.allFigures.filter(f => figMatches(f, view.q) && filterFig(f, view.show)), view.sortFigs);
    return `<p class="tiny sub" style="margin:10px 0 0">${figs.length} figure${figs.length === 1 ? '' : 's'}</p>` + bigShelf(cat, figs, true);
  }

  function seriesPage(cat, s) {
    const opened = s.figures.filter(has).length;
    const figs = sortFigs(s.figures.filter(f => filterFig(f, view.seriesShow)), view.seriesSort);
    const secOwned = s.figures.some(f => f.secret && has(f));
    return `<div class="wrap">
      <a class="back" href="#/c/${cat.collection}">‹ ${esc(cat.name)}</a>
      ${s.custom ? `<button class="edit-btn" data-act="editSeries">edit series</button>` : ''}
      <div class="title-row"><h1 class="big" style="font-size:42px">${esc(s.name)}</h1>
        <span class="count">${opened} / ${s.figures.length} opened${secOwned ? ' · <span class="star-pill">★ got it</span>' : ''}</span></div>
      <div class="row" style="margin-top:12px;flex-wrap:wrap">
        ${chips('sshow', [['all', 'all ' + s.figures.length], ['opened', 'opened'], ['sealed', 'hunting']], view.seriesShow).replace('class="filters"', 'class="filters" style="margin:0"')}
        <span class="spacer"></span>
        <label class="field" style="height:38px">sort <select id="ssortSel" aria-label="Sort figures">
          ${[['release', 'lineup'], ['lightest', 'lightest'], ['heaviest', 'heaviest'], ['name', 'name'], ['newest', 'opened date']].map(([v, l]) => `<option value="${v}"${view.seriesSort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      ${bigShelf(cat, figs, false, view.seriesShow === 'all')}
      <div class="legend"><span class="row" style="gap:6px"><i class="bg-0"></i> opened</span><span class="row" style="gap:6px"><i style="border-style:dashed;background:var(--sealed)"></i> still hunting</span></div>
      ${weightList(cat, s)}
    </div>`;
  }

  function weightList(cat, s) {
    const withW = s.figures.filter(f => f.boxAvg != null).sort((a, b) => a.boxAvg - b.boxAvg);
    const noW = s.figures.filter(f => f.boxAvg == null);
    if (!withW.length) return `<h2 class="hand-h">weights in order</h2><p class="empty-note">no weights reported for this series yet.</p>`;
    let prev = null;
    const rows = withW.map(f => {
      const gap = prev == null ? '' : (f.boxAvg - prev).toFixed(2);
      prev = f.boxAvg;
      return `<tr class="${f.secret ? 'sec' : ''}">
        <td><a href="#/c/${cat.collection}/f/${f.id}">${f.secret ? '★ ' : ''}${esc(f.en)}</a>${has(f) ? ' <span class="got" aria-label="opened">✓</span>' : ''}${f.ja ? `<span class="ja" lang="ja">${esc(f.ja)}</span>` : ''}</td>
        <td class="num"><b>${fmt(f.boxAvg)}</b><span class="n">${f.box.mine ? 'mine' : f.box.n + ' pts'}</span></td>
        <td class="num gap">${gap ? '+' + gap : ''}</td>
        <td class="num">${f.bare ? fmt(f.bare.avg) : '—'}</td></tr>`;
    }).join('');
    return `<h2 class="hand-h">weights in order</h2>
      <div class="wt-wrap"><table class="wt-table">
        <thead><tr><th>figure</th><th class="num">with box</th><th class="num">gap (with box)</th><th class="num">no box</th></tr></thead>
        <tbody>${rows}${noW.map(f => `<tr><td><a href="#/c/${cat.collection}/f/${f.id}">${f.secret ? '★ ' : ''}${esc(f.en)}</a></td><td class="num sub" colspan="3">no weight yet</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  function figurePage(cat, f) {
    const it = item(f.key);
    const s = f.series;
    const withW = s.figures.filter(x => x.boxAvg != null && x !== f);
    let near = '';
    if (f.boxAvg != null && withW.length) {
      const lighter = withW.filter(x => x.boxAvg <= f.boxAvg).sort((a, b) => b.boxAvg - a.boxAvg)[0];
      const heavier = withW.filter(x => x.boxAvg > f.boxAvg).sort((a, b) => a.boxAvg - b.boxAvg)[0];
      const cell = (x, me) => {
        if (!x) return '<div style="visibility:hidden"></div>';
        const d = x.boxAvg - f.boxAvg;
        const lbl = me ? 'this one' : `${Math.abs(d).toFixed(2)} g ${d < 0 ? 'lighter' : 'heavier'}`;
        return `<${me ? 'div' : 'a href="#/c/' + cat.collection + '/f/' + x.id + '"'} class="${me ? 'me' : ''}" style="height:${me ? 84 : 76}px">
          <span class="nm">${me && f.secret ? '★ ' : ''}${esc(x.en)}</span><span class="w">${fmt(x.boxAvg)} g</span><span class="d">${lbl}</span></${me ? 'div' : 'a'}>`;
      };
      const close = withW.filter(x => Math.abs(x.boxAvg - f.boxAvg) <= 1).sort((a, b) => Math.abs(a.boxAvg - f.boxAvg) - Math.abs(b.boxAvg - f.boxAvg));
      near = `<h2 class="hand-h">who weighs about the same?</h2>
        <div class="near">${cell(lighter, false)}${cell(f, true)}${cell(heavier, false)}</div>
        <div class="plank-sm" style="margin:0 0 0"></div>
        <p class="small" style="margin:6px 0 0;font-weight:700">${close.length
          ? `Within a gram: ${close.map(x => `${esc(x.en)} (${fmt(x.boxAvg)} g)`).join(', ')}. Weigh carefully!`
          : 'Nothing else in this series is within a gram of it.'}</p>`;
    }
    const box = f.box, bare = f.bare;
    const range = w => (w && w.n > 1 && w.min != null) ? `<span class="range">reports ranged ${fmt(w.min)}–${fmt(w.max)} g</span>` : '';
    const photo = myPhotos.get(f.key);
    return `<div class="wrap">
      <a class="back" href="#/c/${cat.collection}/s/${s.slug}">‹ ${esc(s.name)}</a>
      ${f.custom ? `<button class="edit-btn" data-act="editFig">edit figure</button>` : ''}
      <div class="fig-top">
        <div class="open-box">
          <svg class="boxsvg" viewBox="0 0 180 170" aria-hidden="true">
            <polygon points="36,42 162,42 152,8 46,8" fill="var(--b1)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
            <polygon points="36,42 162,42 152,8 46,8" fill="var(--ink)" opacity=".1"/>
            <polygon points="14,58 36,42 162,42 144,58" fill="var(--b1)"/>
            <polygon points="14,58 36,42 162,42 144,58" fill="#000" opacity=".5"/>
            <polygon points="36,42 162,42 144,58 14,58" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
            <polygon points="144,58 162,42 162,150 144,166" fill="var(--b1)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
            <polygon points="144,58 162,42 162,150 144,166" fill="var(--ink)" opacity=".18"/>
            <polygon points="14,58 36,42 20,20 1,34" fill="var(--b1)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
            <polygon points="14,58 36,42 20,20 1,34" fill="var(--ink)" opacity=".05"/>
            <polygon points="144,58 162,42 179,60 162,78" fill="var(--b1)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
            <polygon points="144,58 162,42 179,60 162,78" fill="var(--ink)" opacity=".22"/>
          </svg>
          <button class="photo-btn" data-act="pickPhoto" aria-label="${photo ? 'Change' : 'Add'} your photo of ${esc(f.en)}">
            ${sketch(f, 70, 1.6)}
            <span class="lbl">${photo ? 'change photo' : 'add your photo'}</span>
            ${photoTag(cat.collection, f, 'photo')}
          </button>
          <input type="file" id="photoFile" accept="image/*" class="visually-hidden" tabindex="-1">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:0">
          ${f.secret ? `<span class="secret-badge">★ secret</span>` : ''}
          <h1 class="fig-name">${esc(f.en)}</h1>
          ${f.ja ? `<span class="ja-name" lang="ja">${esc(f.ja)}${f.jaUnsure ? ' <span class="tiny sub">(not sure)</span>' : ''}</span>` : (f.custom ? '' : `<span class="ja-name missing">Japanese name not listed yet</span>`)}
          <label class="check"><input type="checkbox" id="haveChk"${it.have ? ' checked' : ''}> I have this one</label>
        </div>
      </div>
      ${photo ? `<button class="danger" data-act="removePhoto">remove my photo</button>` : ''}
      ${it.have ? `<div class="mine">
        <label>opened on<input type="date" id="dateIn" value="${esc(it.date)}"></label>
        <label>how many<span class="qty"><button type="button" data-act="qty" data-d="-1" aria-label="One fewer">−</button><output id="qtyOut">${it.qty || 1}</output><button type="button" data-act="qty" data-d="1" aria-label="One more">+</button></span></label>
        <label class="notes">notes<textarea id="notesIn" placeholder="where you found it, trades…">${esc(it.notes)}</textarea></label>
      </div>` : ''}
      <div class="scales">
        <div class="scale">
          <div class="pan"></div>
          <div class="lcd">${box ? fmt(box.avg) : '--.--'}<small> g</small></div>
          <span class="lbl-s">${f.custom ? 'weight with box' : 'average with box'}</span>
          ${f.custom ? '' : `<div class="tally">${tally(box ? box.n : 0)}<span class="tiny sub">${box && box.n ? `${box.n} ${box.n === 1 ? 'person' : 'people'} weighed it` : ''}</span></div>`}
          ${range(box)}
        </div>
        <div class="bare">
          <span class="lbl-s">no box</span>
          <span class="val">${bare ? fmt(bare.avg) : '—'}<span class="small"> g</span></span>
          ${f.custom ? '' : `<div class="tally">${tally(bare ? bare.n : 0)}${bare && bare.n ? `<span class="tiny sub">${bare.n} ${bare.n === 1 ? 'person' : 'people'}</span>` : ''}</div>`}
          ${range(bare)}
        </div>
      </div>
      ${near}
      ${f.tips ? `<div class="tips-note"><span class="hand" style="font-size:20px">${f.custom ? 'my notes' : 'shake tips'}</span>
        <p class="tip-text">${esc(unwrap(f.tips))}</p></div>` : ''}
    </div>`;
  }

  // The sheet wraps long tips onto new lines inside the cell; join those back so each "- " point reads as one line.
  // The words themselves are left exactly as written.
  const unwrap = t => t.trim().replace(/[ \t]*\n(?!\s*-)\s*/g, ' ').replace(/\n\s*\n/g, '\n');

  function notFound() {
    return `<div class="wrap"><a class="back" href="#/">‹ my trove</a><p class="empty-note">couldn't find that page.</p></div>`;
  }

  // ---------- make your own ----------
  const MAX_NAME = 60, MAX_TIPS = 2000;
  const ID_RE = /^[a-z0-9-]{1,40}$/;
  function newId(name, prefix) {
    const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    return (prefix || '') + (base || 'item') + '-' + Math.random().toString(36).slice(2, 6);
  }
  const cleanName = v => String(v || '').trim().slice(0, MAX_NAME);
  const cleanWeight = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null; };

  // In-page form box. Resolves {action:'ok', values} | {action:'delete'} | null.
  function formBox(title, inner, okLabel, withDelete) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'ask-back';
      wrap.innerHTML = `<form class="ask form" novalidate aria-labelledby="formTitle">
        <h2 id="formTitle" class="hand" style="margin:0 0 10px;font-size:26px;line-height:1">${esc(title)}</h2>
        ${inner}
        <p class="form-err" role="alert"></p>
        <div class="btn-row"><button type="submit" class="btn fill">${esc(okLabel)}</button><button type="button" class="btn" data-ans="cancel">Cancel</button></div>
        ${withDelete ? `<button type="button" class="danger" data-ans="delete">${esc(withDelete)}</button>` : ''}
      </form>`;
      const form = wrap.querySelector('form');
      const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(null); };
      form.addEventListener('submit', e => {
        e.preventDefault();
        const values = {};
        for (const el of form.elements) {
          if (!el.name) continue;
          values[el.name] = el.type === 'checkbox' ? el.checked : el.value;
        }
        const req = form.querySelector('[data-required]');
        if (req && !req.value.trim()) { form.querySelector('.form-err').textContent = 'Give it a name first.'; req.focus(); return; }
        done({ action: 'ok', values });
      });
      wrap.addEventListener('click', e => {
        const b = e.target.closest('[data-ans]');
        if (b) done(b.dataset.ans === 'delete' ? { action: 'delete' } : null);
        else if (e.target === wrap) done(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      const first = form.querySelector('input,textarea');
      if (first) first.focus();
    });
  }
  const field = (label, name, value, extra) => `<label class="ff">${esc(label)}<input name="${name}" value="${esc(value == null ? '' : value)}" ${extra || ''}></label>`;

  async function saveCustom(recs, removeKeys) {
    // One transaction so a half-finished change can't happen.
    const itemKeys = [], photoKeys = [];
    for (const k of (removeKeys || [])) {
      const r = custom.get(k);
      if (r && r.type === 'figure') { itemKeys.push(r.coll + ':' + r.series + '/' + r.id); photoKeys.push(r.coll + ':' + r.series + '/' + r.id); }
    }
    await new Promise((resolve, reject) => {
      const t = db.transaction(['custom', 'items', 'photos'], 'readwrite');
      const sc = t.objectStore('custom'), si = t.objectStore('items'), sp = t.objectStore('photos');
      for (const r of (recs || [])) sc.put(r);
      for (const k of (removeKeys || [])) sc.delete(k);
      for (const k of itemKeys) si.delete(k);
      for (const k of photoKeys) sp.delete(k);
      t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
    for (const r of (recs || [])) custom.set(r.key, r);
    for (const k of (removeKeys || [])) custom.delete(k);
    for (const k of itemKeys) items.delete(k);
    for (const k of photoKeys) { if (myPhotos.get(k)) URL.revokeObjectURL(myPhotos.get(k)); myPhotos.delete(k); }
    buildCatalogs();
  }
  const figRecsOf = (coll, series) => [...custom.values()].filter(r => r.type === 'figure' && r.coll === coll && (series == null || r.series === series));
  const seriesRecsOf = coll => [...custom.values()].filter(r => r.type === 'series' && r.coll === coll);
  function figureRecord(coll, series, v, old) {
    const id = old ? old.id : newId(v.en, 'my-');
    return { key: old ? old.key : `fig:${coll}/${series}/${id}`, type: 'figure', coll, series, id,
      en: cleanName(v.en), ja: cleanName(v.ja), secret: !!v.secret,
      boxW: cleanWeight(v.boxW), bareW: cleanWeight(v.bareW), tips: String(v.tips || '').slice(0, MAX_TIPS),
      created: old ? old.created : Date.now() };
  }
  const figureForm = f => `
    ${field('name', 'en', f && f.en, 'data-required maxlength="60" autocomplete="off"')}
    ${field('Japanese name (optional)', 'ja', f && f.ja, 'maxlength="60" lang="ja" autocomplete="off"')}
    <label class="ff row-check"><input type="checkbox" name="secret"${f && f.secret ? ' checked' : ''}> ★ secret</label>
    <div class="ff-two">
      ${field('weight with box (g)', 'boxW', f && f.box ? f.box.avg : '', 'inputmode="decimal" autocomplete="off"')}
      ${field('weight without box (g)', 'bareW', f && f.bare ? f.bare.avg : '', 'inputmode="decimal" autocomplete="off"')}
    </div>
    <label class="ff">notes / shake tips (optional)<textarea name="tips" maxlength="2000">${esc(f ? f.tips : '')}</textarea></label>`;

  async function makeCollection() {
    const r = await formBox('new collection', field('name', 'name', '', 'data-required maxlength="60" autocomplete="off" placeholder="e.g. Sonny Angel"'), 'Make it');
    if (!r) return;
    const id = newId(r.values.name, 'my-');
    await saveCustom([{ key: 'coll:' + id, type: 'collection', id, name: cleanName(r.values.name), created: Date.now() }]);
    view.tab = 'series'; view.q = ''; view.show = 'all';
    location.hash = '#/c/' + id;
  }
  async function editCollection(cat) {
    const r = await formBox('edit collection', field('name', 'name', cat.name, 'data-required maxlength="60" autocomplete="off"'), 'Save', 'delete this collection');
    if (!r) return;
    const rec = custom.get(cat.rec);
    if (r.action === 'ok') { await saveCustom([{ ...rec, name: cleanName(r.values.name) }]); route(true); return; }
    const n = cat.allFigures.length;
    if (!(await ask(`Delete <b>${esc(cat.name)}</b> and everything in it (${n} figure${n === 1 ? '' : 's'}, with your marks and photos)? This can't be undone.`, 'Delete', 'Keep it'))) return;
    const keys = [rec.key, ...seriesRecsOf(cat.collection).map(x => x.key), ...figRecsOf(cat.collection).map(x => x.key)];
    await saveCustom([], keys);
    location.hash = '#/';
  }
  async function makeSeries(cat) {
    const r = await formBox('new series', `
      ${field('series name', 'name', '', 'data-required maxlength="60" autocomplete="off"')}
      <label class="ff">figures (optional, one per line, put ★ in front of a secret)<textarea name="figs" rows="5" placeholder="Sitting&#10;Peeking&#10;★ Secret one"></textarea></label>`, 'Make it');
    if (!r) return;
    const id = newId(r.values.name);
    const now = Date.now();
    const recs = [{ key: `series:${cat.collection}/${id}`, type: 'series', coll: cat.collection, id, name: cleanName(r.values.name), created: now }];
    String(r.values.figs || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 100).forEach((line, i) => {
      const secret = /^[★*]/.test(line);
      const en = line.replace(/^[★*]\s*/, '');
      if (!en) return;
      const rec = figureRecord(cat.collection, id, { en, secret });
      rec.created = now + i + 1;
      recs.push(rec);
    });
    await saveCustom(recs);
    location.hash = `#/c/${cat.collection}/s/${id}`;
  }
  async function editSeries(cat, sr) {
    const r = await formBox('edit series', field('series name', 'name', sr.name, 'data-required maxlength="60" autocomplete="off"'), 'Save', 'delete this series');
    if (!r) return;
    const rec = custom.get(sr.rec);
    if (r.action === 'ok') { await saveCustom([{ ...rec, name: cleanName(r.values.name) }]); route(true); return; }
    const n = sr.figures.length;
    if (!(await ask(`Delete <b>${esc(sr.name)}</b> and its ${n} figure${n === 1 ? '' : 's'}, with your marks and photos? This can't be undone.`, 'Delete', 'Keep it'))) return;
    await saveCustom([], [rec.key, ...figRecsOf(cat.collection, sr.slug).map(x => x.key)]);
    location.hash = '#/c/' + cat.collection;
  }
  async function makeFigure(cat, sr) {
    const r = await formBox('add a figure', figureForm(null), 'Add it');
    if (!r) return;
    const rec = figureRecord(cat.collection, sr.slug, r.values);
    await saveCustom([rec]);
    location.hash = `#/c/${cat.collection}/f/${sr.slug}/${rec.id}`;
  }
  async function editFigure(cat, f) {
    const r = await formBox('edit figure', figureForm(f), 'Save', 'delete this figure');
    if (!r) return;
    const old = custom.get(f.rec);
    if (r.action === 'ok') { await saveCustom([figureRecord(old.coll, old.series, r.values, old)]); route(true); return; }
    if (!(await ask(`Delete <b>${esc(f.en)}</b>, with your marks and photo? This can't be undone.`, 'Delete', 'Keep it'))) return;
    await saveCustom([], [old.key]);
    location.hash = `#/c/${cat.collection}/s/${f.series.slug}`;
  }

  // ---------- router ----------
  let current = {};
  function parse() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const p = h.split('/').filter(Boolean).map(decodeURIComponent);
    if (p[0] === 'c' && BY_COLL[p[1]]) {
      const cat = BY_COLL[p[1]];
      if (p[2] === 's' && cat.bySlug[p[3]]) return { page: 'series', cat, s: cat.bySlug[p[3]] };
      if (p[2] === 'f' && cat.bySlug[p[3]]) {
        const f = cat.bySlug[p[3]].figures.find(x => x.slug === p[4]);
        if (f) return { page: 'figure', cat, f };
      }
      if (!p[2]) return { page: 'collection', cat };
      return { page: '404' };
    }
    if (!p.length) return { page: 'home' };
    return { page: '404' };
  }
  function route(keepScroll) {
    const r = parse();
    const changed = r.page !== current.page || r.cat !== current.cat || r.s !== current.s || r.f !== current.f;
    current = r;
    applyTheme(r.cat ? r.cat.collection : null);
    let html;
    if (r.page === 'home') { html = homePage(); document.title = 'Tiny Trove'; }
    else if (r.page === 'collection') { html = collectionPage(r.cat); document.title = r.cat.name + ' · Tiny Trove'; }
    else if (r.page === 'series') { html = seriesPage(r.cat, r.s); document.title = r.s.name + ' · Tiny Trove'; }
    else if (r.page === 'figure') { html = figurePage(r.cat, r.f); document.title = r.f.en + ' · Tiny Trove'; }
    else html = notFound();
    const y = window.scrollY;
    app().innerHTML = html;
    if (changed && !keepScroll) window.scrollTo(0, 0); else window.scrollTo(0, y);
  }
  function refreshList() {
    const l = document.getElementById('list');
    if (l && current.page === 'collection') l.innerHTML = view.tab === 'series' ? seriesList(current.cat) : figureGrid(current.cat);
  }

  // ---------- backup ----------
  const blobToDataURL = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  async function exportBackup() {
    const photos = [];
    for (const p of await getAll('photos')) photos.push({ key: p.key, data: await blobToDataURL(p.blob) });
    const data = { app: 'tiny-trove', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), custom: [...custom.values()], items: [...items.values()], photos };
    const name = `tiny-trove-backup-${today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    let done = false;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Tiny Trove backup' }); done = true; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!done) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    await saveSetting('lastBackup', new Date().toISOString());
    toast('Backup saved');
    route(true);
  }
  // ---- backup checking ----
  // Everything in a backup file is checked before anything on the phone is touched.
  const BACKUP_VERSION = 2;   // 2 = adds your own collections / series / figures
  const MAX_FILE = 150 * 1024 * 1024;        // whole backup file
  const MAX_PHOTO = 8 * 1024 * 1024;         // one photo, decoded
  const MAX_NOTES = 2000;
  const PHOTO_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
  const isRealDate = d => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(d + 'T12:00:00Z');
    return !isNaN(t) && t.toISOString().slice(0, 10) === d;
  };
  // Checks your own collections / series / figures in a backup. Returns the clean records.
  function checkCustom(list, out) {
    const recs = new Map();
    if (list === undefined) return recs;
    if (!Array.isArray(list)) throw new Error("That backup's own-collections list is broken.");
    const str = (v, max, optional) => typeof v === 'string' && v.trim().length <= max && (optional || v.trim().length > 0);
    const baseColls = new Set(BASE.map(c => c.collection));
    const baseSeries = new Set(BASE.flatMap(c => c.series.map(x => c.collection + '/' + x.slug)));
    const colls = new Set(baseColls), series = new Set(baseSeries);
    const ok = r => r && typeof r === 'object' && typeof r.id === 'string' && ID_RE.test(r.id);
    for (const r of list) if (ok(r) && r.type === 'collection' && str(r.name, MAX_NAME) && !baseColls.has(r.id)) {
      recs.set('coll:' + r.id, { key: 'coll:' + r.id, type: 'collection', id: r.id, name: r.name.trim(), created: Number.isFinite(r.created) ? r.created : 0 });
      colls.add(r.id);
    }
    for (const r of list) if (ok(r) && r.type === 'series' && str(r.name, MAX_NAME) && typeof r.coll === 'string' && colls.has(r.coll) && !baseSeries.has(r.coll + '/' + r.id)) {
      const key = `series:${r.coll}/${r.id}`;
      recs.set(key, { key, type: 'series', coll: r.coll, id: r.id, name: r.name.trim(), created: Number.isFinite(r.created) ? r.created : 0 });
      series.add(r.coll + '/' + r.id);
    }
    for (const r of list) if (ok(r) && r.type === 'figure' && str(r.en, MAX_NAME) && typeof r.coll === 'string' && typeof r.series === 'string' && series.has(r.coll + '/' + r.series)
        && (r.ja === undefined || r.ja === null || str(r.ja, MAX_NAME, true)) && (r.tips === undefined || r.tips === null || typeof r.tips === 'string')) {
      const w = v => (typeof v === 'number' && isFinite(v) && v > 0 && v < 1000) ? Math.round(v * 100) / 100 : null;
      const key = `fig:${r.coll}/${r.series}/${r.id}`;
      recs.set(key, { key, type: 'figure', coll: r.coll, series: r.series, id: r.id, en: r.en.trim(), ja: (r.ja || '').trim(), secret: r.secret === true,
        boxW: w(r.boxW), bareW: w(r.bareW), tips: (r.tips || '').slice(0, MAX_TIPS), created: Number.isFinite(r.created) ? r.created : 0 });
    }
    out.skippedCustom = list.length - recs.size;
    return recs;
  }
  function knownKeys(customRecs) {
    const k = new Set();
    for (const cat of BASE) for (const sr of cat.series) for (const f of sr.figures) k.add(cat.collection + ':' + f.id);
    for (const r of customRecs.values()) if (r.type === 'figure') k.add(r.coll + ':' + r.series + '/' + r.id);
    return k;
  }
  function checkBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.app !== 'tiny-trove') throw new Error("That file isn't a Tiny Trove backup.");
    const v = data.version === undefined ? 1 : data.version;
    if (!Number.isInteger(v) || v < 1) throw new Error("That backup's version number is broken.");
    if (v > BACKUP_VERSION) throw new Error('That backup was made by a newer version of Tiny Trove. Update the app first.');
    if (!Array.isArray(data.items)) throw new Error('That backup has no figure list.');
    if (data.photos !== undefined && !Array.isArray(data.photos)) throw new Error("That backup's photo list is broken.");
    const out = { items: new Map(), photos: new Map(), skippedItems: 0, skippedPhotos: 0, unknown: 0, skippedCustom: 0 };
    out.custom = checkCustom(data.custom, out);
    const keys = knownKeys(out.custom);
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') { out.skippedItems++; continue; }
      if (!keys.has(raw.key)) { out.unknown++; continue; }
      if (typeof raw.have !== 'boolean') { out.skippedItems++; continue; }
      const it = { key: raw.key, have: raw.have, date: '', qty: 1, notes: '' };
      if (raw.date !== undefined && raw.date !== '' && raw.date !== null) {
        if (typeof raw.date !== 'string' || !isRealDate(raw.date)) { out.skippedItems++; continue; }
        it.date = raw.date;
      }
      if (raw.qty !== undefined && raw.qty !== null) {
        if (!Number.isInteger(raw.qty) || raw.qty < 1 || raw.qty > 999) { out.skippedItems++; continue; }
        it.qty = raw.qty;
      }
      if (raw.notes !== undefined && raw.notes !== null) {
        if (typeof raw.notes !== 'string') { out.skippedItems++; continue; }
        it.notes = raw.notes.slice(0, MAX_NOTES);
      }
      it.updated = Number.isFinite(raw.updated) ? raw.updated : Date.now();
      out.items.set(it.key, it);   // a repeated key: the later entry wins
    }
    for (const raw of (data.photos || [])) {
      if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string' || !keys.has(raw.key) || typeof raw.data !== 'string') { out.skippedPhotos++; continue; }
      const m = PHOTO_RE.exec(raw.data);
      if (!m || m[2].length * 3 / 4 > MAX_PHOTO) { out.skippedPhotos++; continue; }
      let bytes;
      try {
        const bin = atob(m[2]);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch (e) { out.skippedPhotos++; continue; }
      out.photos.set(raw.key, new Blob([bytes], { type: m[1] }));
    }
    return out;
  }

  // In-page yes/no box, since the browser's built-in pop-up isn't available everywhere.
  function ask(message, yes, no) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'ask-back';
      wrap.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="askMsg">
        <p id="askMsg">${message}</p>
        <div class="btn-row"><button class="btn fill" data-ans="1">${esc(yes)}</button><button class="btn" data-ans="0">${esc(no || 'Cancel')}</button></div></div>`;
      const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      wrap.addEventListener('click', e => {
        const b = e.target.closest('[data-ans]');
        if (b) done(b.dataset.ans === '1'); else if (e.target === wrap) done(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      wrap.querySelector('[data-ans="1"]').focus();
    });
  }

  async function importBackup(file) {
    if (file.size > MAX_FILE) { toast('That file is too big to be a Tiny Trove backup.'); return; }
    let checked;
    try {
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { throw new Error("That file isn't a Tiny Trove backup."); }
      checked = checkBackup(data);
    } catch (e) { toast(e.message); return; }
    const opened = [...checked.items.values()].filter(i => i.have).length;
    const skipped = checked.skippedItems + checked.skippedPhotos + checked.unknown + checked.skippedCustom;
    const myColls = [...checked.custom.values()].filter(r => r.type === 'collection').length;
    const myFigs = [...checked.custom.values()].filter(r => r.type === 'figure').length;
    const lines = [
      `<b>${opened}</b> opened figure${opened === 1 ? '' : 's'}`,
      `<b>${checked.photos.size}</b> photo${checked.photos.size === 1 ? '' : 's'}`
    ];
    if (myColls || myFigs) lines.push(`${myColls} own collection${myColls === 1 ? '' : 's'}, ${myFigs} own figure${myFigs === 1 ? '' : 's'}`);
    if (checked.skippedCustom) lines.push(`${checked.skippedCustom} broken own-collection entr${checked.skippedCustom === 1 ? 'y' : 'ies'} (skipped)`);
    if (checked.unknown) lines.push(`${checked.unknown} figure${checked.unknown === 1 ? '' : 's'} this app doesn't know (skipped)`);
    if (checked.skippedItems) lines.push(`${checked.skippedItems} broken entr${checked.skippedItems === 1 ? 'y' : 'ies'} (skipped)`);
    if (checked.skippedPhotos) lines.push(`${checked.skippedPhotos} broken photo${checked.skippedPhotos === 1 ? '' : 's'} (skipped)`);
    const ok = await ask(`Replace everything on this device with this backup?<br><span class="small">${lines.join(' · ')}</span>`, 'Replace', 'Cancel');
    if (!ok) return;
    // One transaction: either the whole backup goes in, or nothing on the phone changes.
    try {
      await new Promise((resolve, reject) => {
        const t = db.transaction(['items', 'photos', 'custom'], 'readwrite');
        const si = t.objectStore('items'), sp = t.objectStore('photos'), sc = t.objectStore('custom');
        si.clear(); sp.clear(); sc.clear();
        for (const r of checked.custom.values()) sc.put(r);
        for (const it of checked.items.values()) si.put(it);
        for (const [key, blob] of checked.photos) sp.put({ key, blob });
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
      });
    } catch (e) { toast("Couldn't load the backup. Nothing on this device was changed."); return; }
    custom.clear();
    for (const [k, r] of checked.custom) custom.set(k, r);
    buildCatalogs();
    items.clear();
    for (const it of checked.items.values()) items.set(it.key, it);
    myPhotos.forEach(u => URL.revokeObjectURL(u)); myPhotos.clear();
    for (const [key, blob] of checked.photos) myPhotos.set(key, URL.createObjectURL(blob));
    toast(skipped ? `Backup loaded (${skipped} skipped)` : 'Backup loaded');
    route(true);
  }

  // ---------- events ----------
  let notesTimer;
  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { view.tab = tab.dataset.tab; if (view.tab === 'all' && view.show === 'done') view.show = 'all'; route(true); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'export') exportBackup();
    if (a === 'newColl') makeCollection();
    if (a === 'editColl' && current.cat) editCollection(current.cat);
    if (a === 'newSeries' && current.cat) makeSeries(current.cat);
    if (a === 'editSeries' && current.s) editSeries(current.cat, current.s);
    if (a === 'newFig' && current.s) makeFigure(current.cat, current.s);
    if (a === 'editFig' && current.f) editFigure(current.cat, current.f);
    if (a === 'import') document.getElementById('importFile').click();
    if (a === 'pickPhoto') document.getElementById('photoFile').click();
    if (a === 'removePhoto' && current.f) {
      if (!(await ask('Remove your photo of ' + esc(current.f.en) + '?', 'Remove', 'Keep it'))) return;
      await del('photos', current.f.key);
      URL.revokeObjectURL(myPhotos.get(current.f.key)); myPhotos.delete(current.f.key);
      route(true);
    }
    if (a === 'qty' && current.f) {
      const it = item(current.f.key);
      it.qty = Math.max(1, (it.qty || 1) + Number(act.dataset.d));
      await saveItem(it);
      document.getElementById('qtyOut').textContent = it.qty;
    }
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'importFile' && t.files[0]) { await importBackup(t.files[0]); t.value = ''; }
    if (t.id === 'themeSel') { await saveSetting('theme', t.value); route(true); }
    if (t.id === 'sortSel') { if (view.tab === 'series') view.sortSeries = t.value; else view.sortFigs = t.value; refreshList(); }
    if (t.id === 'ssortSel') { view.seriesSort = t.value; route(true); }
    if (t.name === 'show') { view.show = t.value; route(true); }
    if (t.name === 'sshow') { view.seriesShow = t.value; route(true); }
    if (t.id === 'haveChk' && current.f) {
      const it = item(current.f.key);
      it.have = t.checked;
      if (it.have && !it.date) it.date = today();
      if (!it.qty) it.qty = 1;
      await saveItem(it);
      askPersist();
      route(true);
    }
    if (t.id === 'dateIn' && current.f) { const it = item(current.f.key); it.date = t.value; await saveItem(it); }
    if (t.id === 'photoFile' && t.files[0] && current.f) {
      try {
        const blob = await shrinkImage(t.files[0], 1000);
        await put('photos', { key: current.f.key, blob });
        if (myPhotos.get(current.f.key)) URL.revokeObjectURL(myPhotos.get(current.f.key));
        myPhotos.set(current.f.key, URL.createObjectURL(blob));
        askPersist();
        route(true);
      } catch (err) { toast("Couldn't read that photo"); }
      t.value = '';
    }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'q') { view.q = t.value.trim(); refreshList(); }
    if (t.id === 'notesIn' && current.f) {
      clearTimeout(notesTimer);
      const key = current.f.key, val = t.value;
      notesTimer = setTimeout(async () => { const it = item(key); it.notes = val; await saveItem(it); }, 400);
    }
  });
  window.addEventListener('hashchange', () => route());

  // ---------- start ----------
  (async function start() {
    try { await loadAll(); }
    catch (e) {
      app().innerHTML = `<div class="wrap"><p class="empty-note">This browser blocked on-device storage, so Tiny Trove can't save here. (Private browsing does this.)</p></div>`;
      return;
    }
    askPersist().then(() => { if (current.page === 'home') route(true); });
    route();
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
})();
