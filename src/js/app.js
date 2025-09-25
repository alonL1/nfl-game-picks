import { db, serverTimestamp, addDoc, collection, query, where, getDocs, firebaseReady } from './firebase-init.js';

const STORAGE_KEY = 'nfl_picks_local_v1';
const SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

const el = {
  status: document.getElementById('status'),
  games: document.getElementById('games'),
  displayName: document.getElementById('displayName'),
  leagueId: document.getElementById('leagueId'),
  refreshBtn: document.getElementById('refreshBtn'),
  clearLocalBtn: document.getElementById('clearLocalBtn'),
  submitAllBtn: document.getElementById('submitAllBtn')
};

function setStatus(text, type = 'info') {
  if (!el.status) return;
  el.status.textContent = text || '';
  el.status.dataset.type = type;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { displayName: '', leagueId: 'demo-league', picks: {} };
  } catch {
    return { displayName: '', leagueId: 'demo-league', picks: {} };
  }
}

function saveLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseKickoff(event) {
  let kickoffTs = null;
  let kickoffText = 'TBD';

  if (event.date) {
    const dt = new Date(event.date);
    if (!isNaN(dt.getTime())) {
      kickoffTs = dt.getTime();
      kickoffText = dt.toUTCString();
    }
  }

  return { kickoffTs, kickoffText };
}

function normalizeEvents(events) {
  return (events || []).map(ev => {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const competitors = comp.competitors || [];

    let home = '';
    let away = '';
    let homeLogo = '';
    let awayLogo = '';
    let homeRecord = '';
    let awayRecord = '';

    for (const c of competitors) {
      const teamName = (c.team && (c.team.displayName || c.team.name || c.team.abbreviation)) || '';

      // robust logo extraction: try many common shapes
      let logoHref = '';
      if (c.team) {
        // ESPN sometimes uses c.team.logos[0].href, sometimes c.team.logo, sometimes logos[0].url etc.
        const logosArr = c.team.logos || null;
        if (Array.isArray(logosArr) && logosArr.length) {
          logoHref = logosArr[0].href || logosArr[0].url || '';
        } else if (c.team.logo) {
          logoHref = c.team.logo;
        } else if (c.team.officialLogo && (c.team.officialLogo.href || c.team.officialLogo.url)) {
          logoHref = c.team.officialLogo.href || c.team.officialLogo.url;
        }
      }
      // Normalize protocol-relative URLs like //a.espncdn.com/...
      if (logoHref && logoHref.startsWith('//')) logoHref = 'https:' + logoHref;
      // trim
      logoHref = (logoHref || '').trim();

      // Try to get an overall/total record summary like "2-1"
      let recordSummary = '';
      if (Array.isArray(c.records) && c.records.length) {
        const overall = c.records.find(r => r.type === 'total' || r.type === 'overall') || c.records[0];
        recordSummary = (overall && (overall.summary || overall.displayValue)) || '';
      } else if (c.record && (c.record.summary || c.record.displayValue)) {
        recordSummary = c.record.summary || c.record.displayValue;
      }

      if (c.homeAway === 'home') {
        home = teamName || home;
        homeLogo = logoHref || homeLogo;
        homeRecord = recordSummary || homeRecord;
      }
      if (c.homeAway === 'away') {
        away = teamName || away;
        awayLogo = logoHref || awayLogo;
        awayRecord = recordSummary || awayRecord;
      }
    }

    if (!home && competitors[0] && competitors[0].team) home = competitors[0].team.displayName || competitors[0].team.name || '';
    if (!away && competitors[1] && competitors[1].team) away = competitors[1].team.displayName || competitors[1].team.name || '';

    const { kickoffTs, kickoffText } = parseKickoff(ev);
    const gameId = ev.id || (comp && comp.id) || `${home}-${away}-${ev.date || ''}`;

    return { gameId, home, away, homeLogo, awayLogo, homeRecord, awayRecord, kickoffTs, kickoffText };
  });
}

async function fetchSchedule() {
  const res = await fetch(SCHEDULE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
  const data = await res.json();
  return normalizeEvents(data.events || []);
}

function renderGameCard(game, state) {
  const wrapper = document.createElement('article');
  wrapper.className = 'game-card';
  wrapper.dataset.gameId = game.gameId;

  const isLocked = game.kickoffTs && Date.now() >= game.kickoffTs;
  const pick = state.picks[game.gameId] || '';

  wrapper.innerHTML = `
    <div class="kickoff">Kickoff: ${game.kickoffText} ${isLocked ? '<span class="lock">(locked)</span>' : ''}</div>

    <div class="pick-options">
      <label class="pick-label" title="${game.away}">
        <input type="radio" name="pick-${game.gameId}" value="${game.away}" aria-label="Pick ${game.away}" ${pick === game.away ? 'checked' : ''} ${isLocked ? 'disabled' : ''}/>
        <div class="pick-left">
          ${game.awayLogo ? `<img class="pick-logo" loading="lazy" src="${game.awayLogo}" alt="${game.away} logo" onerror="this.style.display='none'"/>` : `<span class="pick-fallback">${game.away}</span>`}
        </div>
        <div class="pick-meta">
          <div class="team-name">${game.away}</div>
          ${game.awayRecord ? `<div class="team-record muted">(${game.awayRecord})</div>` : ''}
        </div>
      </label>

      <div class="at center">at</div>

      <label class="pick-label" title="${game.home}">
        <input type="radio" name="pick-${game.gameId}" value="${game.home}" aria-label="Pick ${game.home}" ${pick === game.home ? 'checked' : ''} ${isLocked ? 'disabled' : ''}/>
        <div class="pick-left">
          ${game.homeLogo ? `<img class="pick-logo" loading="lazy" src="${game.homeLogo}" alt="${game.home} logo" onerror="this.style.display='none'"/>` : `<span class="pick-fallback">${game.home}</span>`}
        </div>
        <div class="pick-meta">
          <div class="team-name">${game.home}</div>
          ${game.homeRecord ? `<div class="team-record muted">(${game.homeRecord})</div>` : ''}
        </div>
      </label>
    </div>

    <div class="picks-list" id="picks-${game.gameId}">Loading picks...</div>
  `;

  // Radio change handlers
  const radios = wrapper.querySelectorAll(`input[name="pick-${game.gameId}"]`);
  radios.forEach(r => {
    r.addEventListener('change', () => {
      const selected = wrapper.querySelector(`input[name="pick-${game.gameId}"]:checked`);
      state.picks[game.gameId] = selected ? selected.value : '';
      saveLocal(state);
    });
  });

  // Load picks for this game
  loadPicksForGame(game.gameId, wrapper);

  return wrapper;
}

async function loadPicksForGame(gameId, wrapper) {
  const ready = await firebaseReady;
  const listEl = wrapper.querySelector(`#picks-${gameId}`);

  if (!ready || !db || !collection || !query || !where || !getDocs) {
    if (listEl) listEl.textContent = 'Realtime disabled (no DB configured).';
    return;
  }

  try {
    const league = (el.leagueId && el.leagueId.value) || 'demo-league';
    const q = query(collection(db, 'picks'), where('leagueId', '==', league), where('gameId', '==', gameId));
    const snap = await getDocs(q);

    if (!listEl) return;
    if (snap.empty) {
      listEl.textContent = 'No picks yet.';
      return;
    }

    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      items.push(`${d.displayName || 'Anonymous'}: ${d.pick}`);
    });
    listEl.innerHTML = items.map(t => `<div>${t}</div>`).join('');
  } catch (err) {
    console.error('loadPicksForGame error:', err);
    if (listEl) listEl.textContent = 'Failed to load picks.';
  }
}

async function submitAllPicks() {
  const displayName = (el.displayName.value || '').trim();
  const leagueId = (el.leagueId.value || '').trim() || 'demo-league';

  if (!displayName) {
    alert('Please enter your name.');
    return;
  }

  const ready = await firebaseReady;
  if (!ready || !db || !addDoc || !collection || !serverTimestamp) {
    alert('Firestore not configured. Paste your Firebase config into src/js/firebase-config.js.');
    return;
  }

  // Collect all picks
  const picks = [];
  document.querySelectorAll('.game-card').forEach(card => {
    const gameId = card.dataset.gameId;
    const selected = card.querySelector(`input[name="pick-${gameId}"]:checked`);
    if (selected) {
      picks.push({
        leagueId,
        gameId,
        displayName,
        pick: selected.value,
        timestamp: serverTimestamp()
      });
    }
  });

  if (picks.length === 0) {
    alert('Please select at least one pick.');
    return;
  }

  try {
    el.submitAllBtn.disabled = true;
    el.submitAllBtn.textContent = 'Submitting...';

    // Submit all picks
    const promises = picks.map(pick => addDoc(collection(db, 'picks'), pick));
    await Promise.all(promises);

    setStatus(`Successfully submitted ${picks.length} picks!`, 'success');

    // Refresh picks display
    document.querySelectorAll('.game-card').forEach(card => {
      const gameId = card.dataset.gameId;
      loadPicksForGame(gameId, card);
    });

  } catch (err) {
    console.error(err);
    setStatus('Failed to submit picks. Please try again.', 'error');
    alert('Failed to submit picks. Check console for details.');
  } finally {
    el.submitAllBtn.disabled = false;
    el.submitAllBtn.textContent = 'Submit All Picks';
  }
}

async function render() {
  const state = loadLocal();
  el.displayName.value = state.displayName || '';
  el.leagueId.value = state.leagueId || 'demo-league';

  setStatus('Loading schedule...');

  try {
    const games = await fetchSchedule();
    el.games.innerHTML = '';

    games.forEach(g => {
      const card = renderGameCard(g, state);
      el.games.appendChild(card);
    });

    if (!db) {
      setStatus('Local mode: paste Firebase config to enable picks persistence.', 'info');
    } else {
      setStatus('Schedule loaded. Select your picks and click Submit All Picks.', 'success');
    }
  } catch (err) {
    console.error(err);
    setStatus('Failed to load schedule. Please refresh.', 'error');
  }

  // Persist name/league changes
  el.displayName.addEventListener('input', () => {
    const s = loadLocal();
    s.displayName = el.displayName.value;
    saveLocal(s);
  });

  el.leagueId.addEventListener('input', () => {
    const s = loadLocal();
    s.leagueId = el.leagueId.value || 'demo-league';
    saveLocal(s);
  });
}

// Event listeners
el.refreshBtn.addEventListener('click', () => {
  render();
});

el.clearLocalBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  setStatus('Cleared local selections.');
  render();
});

el.submitAllBtn.addEventListener('click', submitAllPicks);

// Initialize
render();