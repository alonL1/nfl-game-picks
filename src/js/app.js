import { db, serverTimestamp, addDoc, collection, query, where, onSnapshot } from './firebase-init.js';

const STORAGE_KEY = 'nfl_picks_local_v1';
const SCHEDULE_URL = 'https://www.thesportsdb.com/api/v1/json/1/eventsnextleague.php?id=4391';

const el = {
  status: document.getElementById('status'),
  games: document.getElementById('games'),
  displayName: document.getElementById('displayName'),
  leagueId: document.getElementById('leagueId'),
  refreshBtn: document.getElementById('refreshBtn'),
  clearLocalBtn: document.getElementById('clearLocalBtn')
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
  const dateStr = event.dateEvent || event.dateEventLocal || null;
  const timeStr = event.strTime || event.strTimeLocal || null; // usually UTC
  const tsStr = event.strTimestamp || null;
  let kickoffTs = null;
  if (dateStr && timeStr) {
    const dt = new Date(`${dateStr}T${timeStr}Z`);
    if (!isNaN(dt.getTime())) kickoffTs = dt.getTime();
  }
  if (!kickoffTs && tsStr) {
    const dt = new Date(tsStr);
    if (!isNaN(dt.getTime())) kickoffTs = dt.getTime();
  }
  const kickoffText = kickoffTs ? new Date(kickoffTs).toUTCString() : 'TBD';
  return { kickoffTs, kickoffText };
}

function normalizeEvents(events) {
  return (events || []).map(e => {
    const { kickoffTs, kickoffText } = parseKickoff(e);
    return {
      gameId: e.idEvent || `${e.idHomeTeam}-${e.idAwayTeam}-${e.dateEvent}`,
      home: e.strHomeTeam || 'Home',
      away: e.strAwayTeam || 'Away',
      kickoffTs,
      kickoffText
    };
  });
}

async function fetchSchedule() {
  const res = await fetch(SCHEDULE_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Schedule fetch failed: ${res.status}`);
  const data = await res.json();
  return normalizeEvents(data.events);
}

function renderGameCard(game, state) {
  const wrapper = document.createElement('article');
  wrapper.className = 'game-card';
  const isLocked = game.kickoffTs && Date.now() >= game.kickoffTs;
  const pick = state.picks[game.gameId] || '';
  wrapper.innerHTML = `
    <div class="teams">
      <span>${game.away}</span>
      <span>at</span>
      <span>${game.home}</span>
    </div>
    <div class="kickoff">Kickoff: ${game.kickoffText} ${isLocked ? '<span class="lock">(locked)</span>' : ''}</div>
    <div class="pick-options">
      <label><input type="radio" name="pick-${game.gameId}" value="${game.away}" ${pick === game.away ? 'checked' : ''} ${isLocked ? 'disabled' : ''}/> ${game.away}</label>
      <label><input type="radio" name="pick-${game.gameId}" value="${game.home}" ${pick === game.home ? 'checked' : ''} ${isLocked ? 'disabled' : ''}/> ${game.home}</label>
      <button class="submit-pick" ${isLocked ? 'disabled' : ''}>Submit pick</button>
    </div>
    <div class="picks-list" id="picks-${game.gameId}">No picks yet.</div>
  `;

  // Local radio handlers
  const radios = wrapper.querySelectorAll(`input[name="pick-${game.gameId}"]`);
  radios.forEach(r => {
    r.addEventListener('change', () => {
      const selected = wrapper.querySelector(`input[name="pick-${game.gameId}"]:checked`);
      state.picks[game.gameId] = selected ? selected.value : '';
      saveLocal(state);
    });
  });

  const submitBtn = wrapper.querySelector('.submit-pick');
  submitBtn.addEventListener('click', async () => {
    const selected = wrapper.querySelector(`input[name="pick-${game.gameId}"]:checked`);
    const pickValue = selected ? selected.value : '';
    if (!pickValue) {
      alert('Please select a team first.');
      return;
    }
    const displayName = (el.displayName.value || '').trim();
    const leagueId = (el.leagueId.value || '').trim() || 'demo-league';
    if (!displayName) {
      alert('Please enter your name.');
      return;
    }
    if (!db) {
      alert('Firestore not configured. Paste your Firebase config into src/js/firebase-config.js.');
      return;
    }
    try {
      submitBtn.disabled = true;
      await addDoc(collection(db, 'picks'), {
        leagueId,
        gameId: game.gameId,
        displayName,
        pick: pickValue,
        timestamp: serverTimestamp()
      });
      setStatus('Pick submitted!', 'success');
    } catch (err) {
      console.error(err);
      setStatus('Failed to submit pick. Please try again.', 'error');
      alert('Failed to submit pick. Check console for details.');
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Firestore realtime picks for this game
  if (db && onSnapshot) {
    try {
      const q = query(collection(db, 'picks'), where('leagueId', '==', el.leagueId.value || 'demo-league'), where('gameId', '==', game.gameId));
      onSnapshot(q, (snap) => {
        const listEl = wrapper.querySelector(`#picks-${game.gameId}`);
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
      });
    } catch (e) {
      console.warn('Realtime subscription failed:', e);
    }
  }

  return wrapper;
}

async function render() {
  const state = loadLocal();
  el.displayName.value = state.displayName || '';
  el.leagueId.value = state.leagueId || 'demo-league';
  setStatus('Loading schedule...');
  try {
    const games = await fetchSchedule();
    el.games.innerHTML = '';
    games.forEach(g => el.games.appendChild(renderGameCard(g, state)));
    if (!db) {
      setStatus('Local mode: paste Firebase config to enable realtime picks.', 'info');
    } else {
      setStatus('Connected. Realtime picks enabled.', 'success');
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

// Buttons
el.refreshBtn.addEventListener('click', () => {
  render();
});
el.clearLocalBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  setStatus('Cleared local selections.');
  render();
});

// Kick off
render();


