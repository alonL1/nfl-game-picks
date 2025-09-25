import { db, serverTimestamp, collection, query, where, getDocs, firebaseReady, doc, setDoc } from './firebase-init.js';

const STORAGE_KEY = 'nfl_picks_local_v1';
const SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Helpers for user normalization and deterministic document IDs
const normalizeName = (s) => (s || '').trim().toLowerCase();
const pickDocId = (league, nameKey, gameId) => `${league}__${nameKey}__${gameId}`;

const el = {
  status: document.getElementById('status'),
  games: document.getElementById('games'),
  displayName: document.getElementById('displayName'),
  leagueId: document.getElementById('leagueId'),
  weekSelect: document.getElementById('weekSelect'),
  refreshBtn: document.getElementById('refreshBtn'),
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
    return raw ? JSON.parse(raw) : { displayName: '', leagueId: '', week: '4', picks: {} };
  } catch {
    return { displayName: '', leagueId: '', week: '4', picks: {} };
  }
}

function saveLocal(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function parseKickoff(event) {
  let kickoffTs = null;
  let kickoffText = 'TBD';
  let statusText = '';
  let completed = false;

  if (event.date) {
    const dt = new Date(event.date);
    if (!isNaN(dt.getTime())) {
      kickoffTs = dt.getTime();
      kickoffText = dt.toUTCString();
    }
  }

  // Try to read completion status and short status text
  const comp = (event.competitions && event.competitions[0]) || {};
  const status = (comp.status) || (event.status) || {};
  const type = status.type || {};
  completed = Boolean(type.completed);
  statusText = (type.shortDetail || type.detail || '').trim();

  return { kickoffTs, kickoffText, statusText, completed };
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
    let winnerTeam = '';

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

      // detect winner if available
      if (c.winner === true) {
        winnerTeam = teamName || winnerTeam;
      }
    }

    if (!home && competitors[0] && competitors[0].team) home = competitors[0].team.displayName || competitors[0].team.name || '';
    if (!away && competitors[1] && competitors[1].team) away = competitors[1].team.displayName || competitors[1].team.name || '';

    const { kickoffTs, kickoffText, statusText, completed } = parseKickoff(ev);
    const gameId = ev.id || (comp && comp.id) || `${home}-${away}-${ev.date || ''}`;

    return { gameId, home, away, homeLogo, awayLogo, homeRecord, awayRecord, kickoffTs, kickoffText, statusText, completed, winnerTeam };
  });
}

async function fetchSchedule(week) {
  const url = `${SCHEDULE_URL}?week=${encodeURIComponent(week || '4')}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
  const data = await res.json();
  return normalizeEvents(data.events || []);
}

function renderGameCard(game, state) {
  const wrapper = document.createElement('article');
  wrapper.className = 'game-card';
  wrapper.dataset.gameId = game.gameId;
  if (game.completed && game.winnerTeam) {
    wrapper.dataset.winnerTeam = game.winnerTeam;
  }

  const isLocked = game.kickoffTs && Date.now() >= game.kickoffTs;
  const pick = state.picks[game.gameId] || '';

  wrapper.innerHTML = `
    <div class="kickoff">${game.completed ? (game.statusText ? game.statusText : 'Final') : `Kickoff: ${game.kickoffText}`} ${isLocked && !game.completed ? '<span class="lock">(locked)</span>' : ''}</div>

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
    r.addEventListener('change', async () => {
      const selected = wrapper.querySelector(`input[name="pick-${game.gameId}"]:checked`);
      state.picks[game.gameId] = selected ? selected.value : '';
      saveLocal(state);

      // Auto-save to Firestore
      try {
        const displayName = (el.displayName.value || '').trim();
        const leagueId = (el.leagueId.value || '').trim() || 'demo-league';
        if (!displayName) {
          setStatus('Enter your name to save picks.', 'error');
          return;
        }
        const ready = await firebaseReady;
        if (!ready || !db || !collection || !serverTimestamp || !doc || !setDoc) {
          setStatus('Firestore not configured. Paste your Firebase config.', 'error');
          return;
        }
        const nameKey = normalizeName(displayName);
        const data = {
          league: leagueId,
          name: displayName,
          nameKey,
          gameId: game.gameId,
          teamId: state.picks[game.gameId],
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'picks', pickDocId(leagueId, nameKey, game.gameId)), data);
        setStatus('Saved!', 'success');
        // Refresh picks list for this game
        loadPicksForGame(game.gameId, wrapper);
      } catch (e) {
        console.error('Auto-save failed:', e);
        setStatus('Failed to save pick. Try again.', 'error');
      }
    });
  });

  // Load picks for this game
  // Highlight winner if completed
  if (game.completed && game.winnerTeam) {
    // mark winner label
    const winnerInput = wrapper.querySelector(`input[name="pick-${game.gameId}"][value="${game.winnerTeam}"]`);
    if (winnerInput) {
      const winnerLabel = winnerInput.closest('label');
      if (winnerLabel) winnerLabel.classList.add('winner');
      // Mark other as loser for clarity
      const otherInput = wrapper.querySelector(`input[name="pick-${game.gameId}"]:not([value="${game.winnerTeam}"])`);
      if (otherInput) {
        const loserLabel = otherInput.closest('label');
        if (loserLabel) loserLabel.classList.add('loser');
      }
    }
  }

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
    const q = query(collection(db, 'picks'), where('league', '==', league), where('gameId', '==', gameId));
    const snap = await getDocs(q);

    if (!listEl) return;
    if (snap.empty) {
      listEl.textContent = 'No picks yet.';
      return;
    }

    const items = [];
    const winnerTeam = wrapper?.dataset?.winnerTeam || '';
    const gameCompleted = Boolean(winnerTeam);
    snap.forEach(dref => {
      const d = dref.data();
      const text = `${d.name || 'Anonymous'}: ${d.teamId}`;
      const cls = gameCompleted ? (d.teamId === winnerTeam ? 'winner' : 'loser') : '';
      items.push(`<div class="${cls}">${text}</div>`);
    });
    listEl.innerHTML = items.join('');
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
  if (!ready || !db || !collection || !serverTimestamp || !doc || !setDoc) {
    alert('Firestore not configured. Paste your Firebase config into src/js/firebase-config.js.');
    return;
  }

  // Collect all picks
  const picks = [];
  document.querySelectorAll('.game-card').forEach(card => {
    const gameId = card.dataset.gameId;
    const selected = card.querySelector(`input[name="pick-${gameId}"]:checked`);
    if (selected) {
      const nameKey = normalizeName(displayName);
      const data = {
        league: leagueId,
        name: displayName,
        nameKey,
        gameId,
        teamId: selected.value,
        createdAt: serverTimestamp()
      };
      picks.push({ data, docId: pickDocId(leagueId, nameKey, gameId) });
    }
  });

  if (picks.length === 0) {
    alert('Please select at least one pick.');
    return;
  }

  try {
    el.submitAllBtn.disabled = true;
    el.submitAllBtn.textContent = 'Submitting...';

    // Submit all picks deterministically (overwrite per user/game)
    const promises = picks.map(p => setDoc(doc(db, 'picks', p.docId), p.data));
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
  // Preserve current name input; do not overwrite on refresh
  if (!el.displayName.value) {
    el.displayName.value = state.displayName || '';
  }
  el.leagueId.value = state.leagueId || 'demo-league';
  if (el.weekSelect) el.weekSelect.value = state.week || '4';

  setStatus('Loading schedule...');

  try {
    const games = await fetchSchedule(state.week || '4');
    el.games.innerHTML = '';

    games.forEach(g => {
      const card = renderGameCard(g, state);
      el.games.appendChild(card);
    });

    if (!db) {
      setStatus('Local mode: paste Firebase config to enable picks persistence.', 'info');
    } else {
      setStatus('Schedule loaded. Selections are saved automatically.', 'success');
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

  if (el.weekSelect) {
    el.weekSelect.addEventListener('change', () => {
      const s = loadLocal();
      s.week = el.weekSelect.value || '4';
      saveLocal(s);
    });
  }
}

// Build a map of saved picks for a user in a league: { [gameId]: teamId }
async function getSavedPicksMap(league, displayName) {
  const nameKey = normalizeName(displayName);
  if (!nameKey) return {};
  try {
    const ready = await firebaseReady;
    if (!ready || !db) return {};
    const q = query(
      collection(db, 'picks'),
      where('league', '==', league),
      where('nameKey', '==', nameKey)
    );
    const snap = await getDocs(q);
    const saved = {};
    snap.forEach(dref => {
      const x = dref.data();
      if (x && x.gameId && x.teamId) saved[x.gameId] = x.teamId;
    });
    return saved;
  } catch (e) {
    console.warn('getSavedPicksMap failed:', e);
    return {};
  }
}

function clearSelectionsForUnpickedGames(savedMap) {
  const s = loadLocal();
  document.querySelectorAll('.game-card').forEach(card => {
    const gameId = card.dataset.gameId;
    if (!savedMap[gameId]) {
      // Clear UI radios without triggering change
      const radios = card.querySelectorAll(`input[name="pick-${gameId}"]`);
      radios.forEach(r => { r.checked = false; });
      // Clear local state
      if (s.picks) s.picks[gameId] = '';
    }
  });
  saveLocal(s);
}

// Event listeners
// Restore previously saved picks for the current user after refresh render
async function restoreUserSelections(league, displayName) {
  const nameKey = normalizeName(displayName);
  if (!nameKey) return;

  try {
    const q = query(
      collection(db, 'picks'),
      where('league', '==', league),
      where('nameKey', '==', nameKey)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const saved = {};
    snap.forEach(dref => {
      const x = dref.data();
      if (x && x.gameId && x.teamId) saved[x.gameId] = x.teamId;
    });

    Object.entries(saved).forEach(([gameId, teamId]) => {
      let input =
        document.querySelector(`input[type="radio"][name="pick-${gameId}"][value="${teamId}"]`) ||
        document.querySelector(`.game-card[data-game-id="${gameId}"] input[type="radio"][value="${teamId}"]`);

      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  } catch (e) {
    console.error('restoreUserSelections failed:', e);
  }
}

el.refreshBtn.addEventListener('click', async () => {
  await render();
  const league = (el.leagueId && el.leagueId.value) || 'demo-league';
  const displayName = (el.displayName && el.displayName.value) || '';
  if (displayName) {
    const saved = await getSavedPicksMap(league, displayName);
    clearSelectionsForUnpickedGames(saved);
    await restoreUserSelections(league, displayName);
  }
});

// clear selections button removed

// submit button removed (auto-save on change)

// Initialize
render();