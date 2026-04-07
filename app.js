/* ===================================================
   נטיוב — app.js
   YouTube search filtered by Jewish content filters
   (NetFree, Etrog, Rimon, NetSpark, etc.)
=================================================== */

'use strict';

// ── Config ──────────────────────────────────────────
const MAX_CONCURRENT = 5;
const MAX_RESULTS    = 50;        // per page from YouTube API
let TIMEOUT_MS       = 4500;      // ניתן לשינוי בהגדרות

// ── State ────────────────────────────────────────────
let apiKeys       =[];           // array of {value, status}
let currentKeyIdx = 0;

let currentQuery     = '';
let nextPageToken    = '';
let isLoadingMore    = false;
let currentSearchSession = 0;     // למעקב וביטול חיפושים קודמים

let openCount    = 0;
let blockedCount = 0;
let checkedCount = 0;
let totalCount   = 0;

let heroVisible  = true;

// ── DOM refs ─────────────────────────────────────────
const $ = id => document.getElementById(id);

let heroEl, mainLayout, heroInput, headerInput, btnClearSearch;
let resultsGrid, openCountEl, loadMoreWrap, loadMoreBtn;
let statusDot, statusText;
let queueList, qStatOpen, qStatBlocked;
let qProgFill, qProgChecked, qProgTotal, qProgPct;
let apiKeysList, saveConfirm, apiErrorBanner, testersEl;
let timeoutSlider, timeoutVal;

// ── Boot ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  heroEl         = $('hero');
  mainLayout     = $('mainLayout');
  heroInput      = $('heroInput');
  headerInput    = $('headerInput');
  btnClearSearch = $('btnClearSearch');

  resultsGrid    = $('resultsGrid');
  openCountEl    = $('openCount');
  loadMoreWrap   = $('loadMoreWrap');
  loadMoreBtn    = $('loadMoreBtn');

  statusDot      = $('statusDot');
  statusText     = $('statusText');

  queueList      = $('queueList');
  qStatOpen      = $('qStatOpen');
  qStatBlocked   = $('qStatBlocked');
  qProgFill      = $('qProgFill');
  qProgChecked   = $('qProgChecked');
  qProgTotal     = $('qProgTotal');
  qProgPct       = $('qProgPct');

  apiKeysList    = $('apiKeysList');
  saveConfirm    = $('saveConfirm');
  apiErrorBanner = $('apiErrorBanner');
  testersEl      = $('testers');
  
  timeoutSlider  = $('timeoutSlider');
  timeoutVal     = $('timeoutVal');

  loadSettings();
  loadKeys();
  renderKeyRows();

  // Enter to search
  heroInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') startSearch(heroInput.value.trim());
  });
  headerInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') startSearch(headerInput.value.trim());
  });

  // Clear button logic
  headerInput.addEventListener('input', () => {
    btnClearSearch.style.display = headerInput.value.length > 0 ? 'flex' : 'none';
  });

  // Timeout Slider logic
  timeoutSlider.addEventListener('input', (e) => {
    let secs = parseFloat(e.target.value);
    TIMEOUT_MS = secs * 1000;
    timeoutVal.textContent = secs + ' שניות';
    localStorage.setItem('netyuv_timeout', TIMEOUT_MS);
  });
});

// ── SETTINGS & KEYS ───────────────────────────────────

function loadSettings() {
  const savedTimeout = localStorage.getItem('netyuv_timeout');
  if (savedTimeout) TIMEOUT_MS = parseInt(savedTimeout);
  const secs = TIMEOUT_MS / 1000;
  timeoutSlider.value = secs;
  timeoutVal.textContent = secs + ' שניות';
}

function loadKeys() {
  try {
    const saved = localStorage.getItem('netyuv_api_keys');
    apiKeys = saved ? JSON.parse(saved) :[];
  } catch { apiKeys =[]; }

  const legacy = localStorage.getItem('youtube_api_key');
  if (legacy && !apiKeys.length) {
    apiKeys =[{ value: legacy, status: 'unknown' }];
  }

  if (!apiKeys.length) {
    apiKeys =[{ value: '', status: 'unknown' }];
  }
}

function saveKeys() {
  const rows = apiKeysList.querySelectorAll('.api-key-row');
  apiKeys =[];
  rows.forEach(row => {
    const val = row.querySelector('input').value.trim();
    if (val) apiKeys.push({ value: val, status: row.dataset.status || 'unknown' });
  });
  localStorage.setItem('netyuv_api_keys', JSON.stringify(apiKeys));
  if (apiKeys.length) localStorage.setItem('youtube_api_key', apiKeys[0].value);

  showSaveConfirm();
  renderKeyRows();
}

function addKeyRow(key = '') {
  apiKeys.push({ value: key, status: 'unknown' });
  renderKeyRows();
}

function removeKeyRow(idx) {
  apiKeys.splice(idx, 1);
  if (!apiKeys.length) apiKeys = [{ value: '', status: 'unknown' }];
  renderKeyRows();
}

function renderKeyRows() {
  apiKeysList.innerHTML = '';
  apiKeys.forEach((k, i) => {
    const row = document.createElement('div');
    row.className = 'api-key-row';
    row.dataset.status = k.status;

    const statusLabel = k.status === 'ok'
      ? '<span class="key-status-tag ok">✓ תקין</span>'
      : k.status === 'error'
        ? '<span class="key-status-tag err">✗ שגיאה</span>'
        : '<span class="key-status-tag unknown">לא נבדק</span>';

    row.innerHTML = `
      <input type="password"
             placeholder="AIzaSy..."
             value="${escapeHtml(k.value)}"
             oninput="onKeyInput(${i}, this.value)">
      ${statusLabel}
      <button class="btn-remove-key" onclick="removeKeyRow(${i})" title="הסר מפתח">×</button>
    `;

    apiKeysList.appendChild(row);
  });
}

function onKeyInput(idx, val) {
  if (apiKeys[idx]) {
    apiKeys[idx].value  = val.trim();
    apiKeys[idx].status = 'unknown';
    const row = apiKeysList.children[idx];
    if (row) {
      row.dataset.status = 'unknown';
      row.querySelector('.key-status-tag').outerHTML = '<span class="key-status-tag unknown">לא נבדק</span>';
    }
  }
}

function showSaveConfirm() {
  saveConfirm.classList.add('show');
  setTimeout(() => saveConfirm.classList.remove('show'), 2000);
}

function getNextKey() {
  const usable = apiKeys.filter(k => k.status !== 'error' && k.value);
  if (!usable.length) return null;
  return usable[currentKeyIdx % usable.length];
}

function markKeyError(keyValue) {
  apiKeys.forEach(k => { if (k.value === keyValue) k.status = 'error'; });
  renderKeyRows();
  localStorage.setItem('netyuv_api_keys', JSON.stringify(apiKeys));
}

function markKeyOk(keyValue) {
  apiKeys.forEach(k => { if (k.value === keyValue) k.status = 'ok'; });
  renderKeyRows();
  localStorage.setItem('netyuv_api_keys', JSON.stringify(apiKeys));
}

// ── NAVIGATION (SPA) ──────────────────────────────────
function goHome() {
  currentSearchSession++; // עוצר חיפושים קודמים
  heroVisible = true;
  
  mainLayout.classList.add('hidden');
  document.getElementById('siteHeader').classList.add('hidden');
  heroEl.classList.remove('hidden');
  
  heroInput.value = '';
  headerInput.value = '';
  btnClearSearch.style.display = 'none';
  resultsGrid.innerHTML = '';
  queueList.innerHTML = '';
  testersEl.innerHTML = '';
  
  hideApiError();
  setStatus('idle', 'מוכן לחיפוש');
}

function clearHeaderSearch() {
  headerInput.value = '';
  btnClearSearch.style.display = 'none';
  headerInput.focus();
}

// ── SEARCH FLOW ───────────────────────────────────────

function startSearch(query) {
  if (!query) return;

  // סגירת המקלדת במובייל (Blur)
  heroInput.blur();
  headerInput.blur();

  currentSearchSession++; // Stop previous fetch/process
  
  currentQuery  = query;
  nextPageToken = '';
  currentKeyIdx = 0;

  // Reset counts
  openCount    = 0;
  blockedCount = 0;
  checkedCount = 0;
  totalCount   = 0;

  // Clear previous testers immediately
  testersEl.innerHTML = '';

  // Switch layout
  if (heroVisible) {
    heroEl.classList.add('hidden');
    mainLayout.classList.remove('hidden');
    document.getElementById('siteHeader').classList.remove('hidden');
    heroVisible = false;
  }

  // Sync header input
  document.getElementById('headerInput').value = query;
  btnClearSearch.style.display = 'flex';

  // Clear UI
  resultsGrid.innerHTML = '';
  queueList.innerHTML   = '';
  loadMoreWrap.classList.add('hidden');
  hideApiError();
  updateCounts();
  updateProgress();
  setStatus('scanning', 'מחפש...');

  fetchAndProcess(currentSearchSession);
}

async function loadMore() {
  if (isLoadingMore || !nextPageToken) return;
  
  isLoadingMore = true;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = 'טוען...';
  loadMoreWrap.classList.remove('hidden');

  checkedCount = 0;
  totalCount   = 0;
  updateProgress();
  setStatus('scanning', 'טוען עוד תוצאות...');

  await fetchAndProcess(currentSearchSession);

  isLoadingMore = false;
  loadMoreBtn.disabled  = false;
  loadMoreBtn.textContent = '⬇ טען עוד תוצאות';
}

// פונקציית עזר לניהול זיכרון (Caching)
function getCacheKey(query, page) {
  return `yt_cache_${query}_${page || 'first'}`;
}

async function fetchAndProcess(session) {
  // 1. בדיקת זיכרון מקומי (Cache) כדי לחסוך קריאות API
  const cacheKey = getCacheKey(currentQuery, nextPageToken);
  const cachedData = sessionStorage.getItem(cacheKey);

  let data = null;

  if (cachedData) {
    data = JSON.parse(cachedData);
  } else {
    // 2. ביצוע קריאה ל-API (לולאת מפתחות)
    let quotaExceededCounter = 0;

    while (true) {
      const keyObj = getNextKey();
      if (!keyObj) {
        if (quotaExceededCounter > 0) {
          showApiError('המכסה היומית של כל מפתחות ה-API נגמרה. נא להוסיף מפתח חדש או להמתין למחר.');
        } else {
          showApiError('לא נמצאו מפתחות API תקינים. נא הוסף/תקן מפתח בהגדרות למטה.');
        }
        setStatus('error', 'שגיאת API');
        return;
      }

      try {
        let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(currentQuery)}&type=video&maxResults=${MAX_RESULTS}&key=${keyObj.value}`;
        if (nextPageToken) url += `&pageToken=${nextPageToken}`;

        const res  = await fetch(url);
        if (session !== currentSearchSession) return; // Abort if new search started

        const fetchedData = await res.json();

        if (!res.ok) {
          const reason = fetchedData.error?.errors?.[0]?.reason;
          if (reason === 'quotaExceeded') {
             quotaExceededCounter++;
          }
          const msg = fetchedData.error?.message || 'שגיאה לא ידועה';
          const code = fetchedData.error?.code;
          markKeyError(keyObj.value);
          showApiError(`שגיאת API (מפתח: …${keyObj.value.slice(-6)}): ${msg} [${code}] - מנסה מפתח הבא...`);
          continue; // מנסה אוטומטית את המפתח הבא (נשאר בלולאה)
        }

        markKeyOk(keyObj.value);
        currentKeyIdx++;
        data = fetchedData;
        
        // שמירה לזיכרון הדפדפן להבא
        sessionStorage.setItem(cacheKey, JSON.stringify(data));
        break; // יציאה מהלולאה כי הצלחנו

      } catch (err) {
        if (session !== currentSearchSession) return;
        showApiError(`שגיאת חיבור: לא ניתן לגשת ל-YouTube API. (${err.message})`);
        setStatus('error', 'שגיאת חיבור');
        return;
      }
    }
  } // סיום בלוק API / Cache

  // 3. עיבוד התוצאות
  if (!data) return;

  const items = (data.items ||[]).filter(video => video.id?.videoId);
  nextPageToken = data.nextPageToken || '';

  if (!items.length && !totalCount) {
    resultsGrid.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" stroke-linecap="round"/>
        </svg>
        <p>לא נמצאו תוצאות לחיפוש זה</p>
      </div>`;
    setStatus('idle', 'אין תוצאות');
    return;
  }

  totalCount += items.length;
  updateProgress();

  items.forEach(video => buildQueueItem(video));

  setStatus('scanning', `בודק ${totalCount} סרטונים...`);

  await processInBatches(items, MAX_CONCURRENT, session);
  if (session !== currentSearchSession) return;

  setStatus('done', `${openCount} סרטונים פתוחים`);

  // בדיקת מצב "הכל נחסם" בסיום
  if (totalCount > 0 && openCount === 0) {
    resultsGrid.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" style="color: #dc2626;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
        <p>נמצאו סרטונים ביוטיוב, אך כולם נחסמו על ידי סינון האינטרנט שלך.</p>
      </div>`;
  }

  if (nextPageToken) {
    loadMoreWrap.classList.remove('hidden');
  } else {
    loadMoreWrap.classList.add('hidden');
  }
}

// ── QUEUE ─────────────────────────────────────────────

function buildQueueItem(video) {
  const vid = video.id.videoId;
  const el  = document.createElement('a'); // כעת זה קישור לחיץ כפי שביקשת
  el.className  = 'q-item waiting';
  el.id         = `q-${vid}`;
  el.href       = `https://www.youtube.com/watch?v=${vid}`;
  el.target     = '_blank';
  el.rel        = 'noopener noreferrer';
  el.innerHTML  = `
    <img class="q-thumb" src="${video.snippet.thumbnails.default.url}" alt="" loading="lazy">
    <div class="q-meta">
      <div class="q-title">${escapeHtml(video.snippet.title)}</div>
    </div>
    <span class="q-badge">בהמתנה</span>
  `;
  queueList.appendChild(el);
}

function setQueueItemState(vid, state) {
  const el = $(`q-${vid}`);
  if (!el) return;

  // מחיקת סרטונים שעברו בהצלחה מה-DOM (חסכון בזיכרון)
  if (state === 'passed') {
    el.remove();
    return;
  }

  el.className = `q-item ${state}`;
  const badge = el.querySelector('.q-badge');
  if (!badge) return;
  switch (state) {
    case 'checking': badge.textContent = 'בבדיקה...'; break;
    case 'blocked':  badge.textContent = 'חסום / לא נבדק'; break;
    default:         badge.textContent = 'בהמתנה';      break;
  }
}

// ── PROCESSING ────────────────────────────────────────

async function processInBatches(videos, size, session) {
  for (let i = 0; i < videos.length; i += size) {
    if (session !== currentSearchSession) break;
    await Promise.all(videos.slice(i, i + size).map(v => checkAndDisplay(v, session)));
  }
}

function checkAndDisplay(video, session) {
  return new Promise(async resolve => {
    if (session !== currentSearchSession) return resolve(false);
    if (!video.id?.videoId) return resolve(false); 
    
    const vid = video.id.videoId;

    setQueueItemState(vid, 'checking');
    const qi = $(`q-${vid}`);
    if (qi) qi.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    let ytWaitRetries = 50;
    while (!(window.YT && window.YT.Player) && ytWaitRetries > 0) {
      if (session !== currentSearchSession) return resolve(false);
      await new Promise(r => setTimeout(r, 100));
      ytWaitRetries--;
    }

    let done = false;

    // שימוש בזמן הדינמי TIMEOUT_MS במקום קבוע
    const timeout = setTimeout(() => {
      if (done || session !== currentSearchSession) return;
      done = true;
      setQueueItemState(vid, 'blocked');
      blockedCount++;
      checkedCount++;
      updateProgress();
      cleanup();
      resolve(false);
    }, TIMEOUT_MS);

    const div = document.createElement('div');
    const pid = `p_${vid}_${session}`;
    div.id = pid;
    testersEl.appendChild(div);

    let player;
    try {
      player = new YT.Player(pid, {
        videoId: vid,
        height: '1',
        width: '1',
        events: {
          onReady: () => {
            if (done || session !== currentSearchSession) return;
            done = true;
            clearTimeout(timeout);
            setQueueItemState(vid, 'passed'); // זה ימחק את השורה מה-DOM
            cleanup();
            displayVideo(video);
            openCount++;
            checkedCount++;
            updateProgress();
            resolve(true);
          },
          onError: () => {
            if (done || session !== currentSearchSession) return;
            done = true;
            clearTimeout(timeout);
            setQueueItemState(vid, 'blocked');
            blockedCount++;
            checkedCount++;
            updateProgress();
            cleanup();
            resolve(false);
          }
        }
      });
    } catch(e) {
      if (!done) {
        done = true;
        clearTimeout(timeout);
        if (session === currentSearchSession) {
          setQueueItemState(vid, 'blocked');
          blockedCount++;
          checkedCount++;
          updateProgress();
        }
        resolve(false);
      }
    }

    function cleanup() {
      try { if (player?.destroy) player.destroy(); } catch(e) {}
      $(pid)?.remove();
    }
  });
}

function displayVideo(video) {
  const vid   = video.id.videoId;
  const thumb = video.snippet.thumbnails.high?.url
             || video.snippet.thumbnails.medium?.url
             || video.snippet.thumbnails.default?.url;

  resultsGrid.querySelector('.empty-state')?.remove();

  const card = document.createElement('div');
  card.className = 'video-card';
  card.innerHTML = `
    <a href="https://www.youtube.com/watch?v=${vid}" target="_blank" rel="noopener noreferrer">
      <div class="thumb-wrap">
        <img src="${thumb}" alt="${escapeHtml(video.snippet.title)}" loading="lazy">
        <span class="open-tag">פתוח</span>
        <div class="play-overlay">
          <div class="play-btn">
            <svg viewBox="0 0 24 24"><path d="M5 3l14 9-14 9V3z"/></svg>
          </div>
        </div>
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHtml(video.snippet.title)}</div>
        <div class="card-channel">${escapeHtml(video.snippet.channelTitle)}</div>
      </div>
    </a>
  `;
  resultsGrid.appendChild(card);
}

// ── UI HELPERS ────────────────────────────────────────

function updateCounts() {
  openCountEl.textContent = openCount;
  qStatOpen.textContent    = `${openCount} ✓`;
  qStatBlocked.textContent = `${blockedCount} ✗`;
}

function updateProgress() {
  updateCounts();
  const pct = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;
  qProgFill.style.width      = pct + '%';
  qProgChecked.textContent   = checkedCount;
  qProgTotal.textContent     = totalCount;
  qProgPct.textContent       = pct + '%';
}

function setStatus(state, text) {
  statusDot.className  = 'status-dot ' + state;
  statusText.textContent = text;
}

function showApiError(msg) {
  apiErrorBanner.innerHTML = `<strong>⚠ שגיאת API:</strong> ${escapeHtml(msg)}`;
  apiErrorBanner.classList.add('show');
}

function hideApiError() {
  apiErrorBanner.classList.remove('show');
}

// פונקציה מעודכנת לטיפול בתווים המיוחדים (HTML Entities) - מתקן את הבעיה של ה-&#39;
function escapeHtml(str) {
  if (!str) return '';
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}