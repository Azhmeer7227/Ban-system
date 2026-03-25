import { io, Socket } from 'socket.io-client';
import './style.css';
import type {
  Character,
  RoomState,
  PlayerState,
  BanPhaseState,
  PhaseChangePayload,
  BanPhaseUpdatePayload,
} from '../../shared/types';

// ═══════════════════════════════════════════
// Connection
// ═══════════════════════════════════════════

const BACKEND_URL = 'http://localhost:3001';
const socket: Socket = io(BACKEND_URL);

// ═══════════════════════════════════════════
// State
// ═══════════════════════════════════════════

interface AppState {
  mySocketId: string;
  isAdmin: boolean;
  roomCode: string;
  room: RoomState | null;
  selectedChars: Set<string>;      // selection phase
  banChoice: string | null;         // ban phase
  protectChoice: string | null;     // ban phase
  coinTossWinner: string;
  coinTossLoser: string;
}

const state: AppState = {
  mySocketId: '',
  isAdmin: false,
  roomCode: '',
  room: null,
  selectedChars: new Set(),
  banChoice: null,
  protectChoice: null,
  coinTossWinner: '',
  coinTossLoser: '',
};

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function showPage(pageId: string): void {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(pageId).classList.add('active');
}

function showError(elementId: string, msg: string): void {
  const el = $(elementId);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function toast(msg: string, type: 'info' | 'success' | 'error' | 'warning' = 'info'): void {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function charIconUrl(charId: string): string {
  // Find the character in available list to get the proper icon path
  const ch = state.room?.availableCharacters.find(c => c.id === charId);
  return ch ? `${BACKEND_URL}${ch.icon}` : '';
}

function charName(charId: string): string {
  const ch = state.room?.availableCharacters.find(c => c.id === charId);
  return ch ? ch.name : charId;
}

function getMe(): PlayerState | undefined {
  return state.room?.players.find(p => p.id === state.mySocketId);
}

function getOpponent(): PlayerState | undefined {
  return state.room?.players.find(p => !p.isAdmin && p.id !== state.mySocketId);
}

function getNonAdmins(): PlayerState[] {
  return state.room?.players.filter(p => !p.isAdmin) ?? [];
}

// ═══════════════════════════════════════════
// Socket Events
// ═══════════════════════════════════════════

socket.on('connect', () => {
  state.mySocketId = socket.id ?? '';
  console.log('Connected:', state.mySocketId);
});

socket.on('roomUpdate', (room: RoomState) => {
  state.room = room;
  renderCurrentPhase();
});

socket.on('phaseChange', (payload: PhaseChangePayload) => {
  state.room = payload.room;

  if (payload.phase === 'coinToss' && payload.winner && payload.loser) {
    state.coinTossWinner = payload.winner;
    state.coinTossLoser = payload.loser;
  }

  if (payload.phase === 'selection') {
    showPage('page-selection');
    renderSelection();
  } else if (payload.phase === 'coinToss') {
    showPage('page-cointoss');
    renderCoinToss();
  } else if (payload.phase === 'banPhase') {
    // Reset ban/protect choices
    state.banChoice = null;
    state.protectChoice = null;
    showPage('page-banphase');
    renderBanPhase();
  } else if (payload.phase === 'results') {
    showPage('page-results');
    renderResults();
  }
});

socket.on('banPhaseUpdate', (_payload: BanPhaseUpdatePayload) => {
  // room is already updated via roomUpdate, just re-render
  state.banChoice = null;
  state.protectChoice = null;
  renderBanPhase();
});

socket.on('playerDisconnected', (data: { username: string }) => {
  toast(`${data.username} disconnected`, 'warning');
});

// ═══════════════════════════════════════════
// HOME PAGE
// ═══════════════════════════════════════════

$('btn-create-room').addEventListener('click', () => {
  const username = (($('create-username') as HTMLInputElement).value).trim();
  if (!username) { showError('home-error', 'Please enter a username'); return; }

  socket.emit('createRoom', { username }, (res: { success: boolean; error?: string; room?: RoomState }) => {
    if (res.success && res.room) {
      state.isAdmin = true;
      state.roomCode = res.room.code;
      state.room = res.room;
      showPage('page-lobby');
      renderLobby();
      toast('Room created!', 'success');
    } else {
      showError('home-error', res.error || 'Failed to create room');
    }
  });
});

$('btn-join-room').addEventListener('click', () => {
  const username = (($('join-username') as HTMLInputElement).value).trim();
  const code = (($('join-code') as HTMLInputElement).value).trim().toUpperCase();
  if (!username) { showError('home-error', 'Please enter a username'); return; }
  if (!code) { showError('home-error', 'Please enter a room code'); return; }

  socket.emit('joinRoom', { code, username }, (res: { success: boolean; error?: string; room?: RoomState }) => {
    if (res.success && res.room) {
      state.isAdmin = false;
      state.roomCode = res.room.code;
      state.room = res.room;
      showPage('page-lobby');
      renderLobby();
      toast('Joined room!', 'success');
    } else {
      showError('home-error', res.error || 'Failed to join room');
    }
  });
});

// ═══════════════════════════════════════════
// LOBBY
// ═══════════════════════════════════════════

function renderLobby(): void {
  const room = state.room!;
  $('lobby-room-code').textContent = room.code;

  const list = $('lobby-players-list');
  list.innerHTML = room.players.map(p => `
    <div class="player-card ${p.isAdmin ? 'admin-card' : ''}">
      <div class="player-avatar">${p.username.charAt(0).toUpperCase()}</div>
      <div class="player-info">
        <div class="player-name">${p.username}</div>
        <div class="player-role">${p.isAdmin ? '👑 Admin (Spectator)' : '🎮 Player'}</div>
      </div>
    </div>
  `).join('');

  const nonAdmins = room.players.filter(p => !p.isAdmin);
  const statusEl = $('lobby-status');

  if (nonAdmins.length < 2) {
    statusEl.textContent = `Waiting for players... (${nonAdmins.length}/2)`;
  } else {
    statusEl.textContent = 'Room is ready! Admin can start the selection phase.';
  }

  // Admin controls
  const adminControls = $('admin-controls');
  if (state.isAdmin) {
    adminControls.classList.remove('hidden');
    const btn = $('btn-start-selection') as HTMLButtonElement;
    btn.disabled = nonAdmins.length < 2;
  } else {
    adminControls.classList.add('hidden');
  }
}

$('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard.writeText(state.roomCode).then(() => {
    toast('Room code copied!', 'success');
  });
});

$('btn-start-selection').addEventListener('click', () => {
  socket.emit('startSelection', (res: { success: boolean; error?: string }) => {
    if (!res.success) toast(res.error || 'Failed to start', 'error');
  });
});

// ═══════════════════════════════════════════
// SELECTION
// ═══════════════════════════════════════════

function renderSelection(): void {
  const room = state.room!;
  const me = getMe();
  const grid = $('characters-grid');
  const confirmBtn = $('btn-confirm-selection') as HTMLButtonElement;
  const adminView = $('admin-selection-view');
  const selectionActions = document.querySelector('.selection-actions') as HTMLElement;

  if (state.isAdmin || me?.isAdmin) {
    // Admin: spectate mode
    grid.classList.add('hidden');
    selectionActions.classList.add('hidden');
    adminView.classList.remove('hidden');
    renderAdminSpectateSelection();
    return;
  }

  grid.classList.remove('hidden');
  selectionActions.classList.remove('hidden');
  adminView.classList.add('hidden');

  if (me?.ready) {
    // Already submitted
    grid.innerHTML = '<p style="color: var(--text-secondary); grid-column: 1/-1; text-align: center; font-size: 1.2rem;">✅ Selection submitted! Waiting for opponent...</p>';
    confirmBtn.disabled = true;
    return;
  }

  grid.innerHTML = room.availableCharacters.map(ch => `
    <div class="char-card ${state.selectedChars.has(ch.id) ? 'selected' : ''}" data-char-id="${ch.id}">
      <img class="char-icon" src="${BACKEND_URL}${ch.icon}" alt="${ch.name}">
      <div class="char-name">${ch.name}</div>
    </div>
  `).join('');

  // Click handlers
  grid.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.charId!;
      if (state.selectedChars.has(id)) {
        state.selectedChars.delete(id);
        card.classList.remove('selected');
      } else {
        state.selectedChars.add(id);
        card.classList.add('selected');
      }
      $('selection-count').textContent = String(state.selectedChars.size);
      confirmBtn.disabled = state.selectedChars.size === 0;
    });
  });

  $('selection-count').textContent = String(state.selectedChars.size);
  confirmBtn.disabled = state.selectedChars.size === 0;
}

function renderAdminSpectateSelection(): void {
  const nonAdmins = getNonAdmins();
  const container = $('spectate-selection-status');
  container.innerHTML = nonAdmins.map(p => `
    <div class="spectate-player ${p.ready ? 'ready' : ''}">
      <div class="spectate-player-name">${p.username}</div>
      <div class="spectate-player-status">${p.ready ? '✅ Ready' : '⏳ Selecting...'}</div>
    </div>
  `).join('');
}

$('btn-confirm-selection').addEventListener('click', () => {
  const chars = Array.from(state.selectedChars);
  socket.emit('selectCharacters', { characters: chars }, (res: { success: boolean; error?: string }) => {
    if (res.success) {
      toast('Selection confirmed!', 'success');
      renderSelection(); // re-render to show waiting state
    } else {
      toast(res.error || 'Failed to confirm selection', 'error');
    }
  });
});

// ═══════════════════════════════════════════
// COIN TOSS
// ═══════════════════════════════════════════

function renderCoinToss(): void {
  const coin = $('coin');
  const result = $('cointoss-result');
  result.classList.add('hidden');

  // Trigger flip
  coin.classList.remove('flipping');
  void (coin as HTMLElement).offsetWidth; // force reflow
  coin.classList.add('flipping');

  setTimeout(() => {
    result.classList.remove('hidden');
    $('cointoss-winner-name').textContent = state.coinTossWinner;
  }, 2200);
}

$('btn-proceed-ban').addEventListener('click', () => {
  socket.emit('proceedToBanPhase');
});

// ═══════════════════════════════════════════
// BAN PHASE
// ═══════════════════════════════════════════

function renderBanPhase(): void {
  const room = state.room!;
  const bp = room.banPhase!;
  const me = getMe();
  const isAdminView = state.isAdmin || me?.isAdmin;

  // Determine "me" and "opponent" from non-admin perspective
  let myPlayer: PlayerState;
  let oppPlayer: PlayerState;
  const nonAdmins = getNonAdmins();

  if (isAdminView) {
    // Admin sees: left = coin toss winner, right = coin toss loser
    myPlayer = nonAdmins.find(p => p.id === room.coinTossWinner) || nonAdmins[0];
    oppPlayer = nonAdmins.find(p => p.id === room.coinTossLoser) || nonAdmins[1];
    $('panel-left-title').textContent = `${myPlayer.username}'s Characters`;
    $('panel-right-title').textContent = `${oppPlayer.username}'s Characters`;
  } else {
    myPlayer = me!;
    oppPlayer = getOpponent()!;
    $('panel-left-title').textContent = 'Your Characters';
    $('panel-right-title').textContent = `${oppPlayer.username}'s Characters`;
  }

  // Current turn info
  const currentTurn = bp.turns[bp.currentTurn];
  if (currentTurn) {
    const turnPlayer = room.players.find(p => p.id === currentTurn.userId);
    $('turn-player-name').textContent = turnPlayer?.username || '---';
    $('turn-action').textContent = currentTurn.label;
  }

  // Render left panel (my/winner's characters)
  renderCharacterList('your-characters-list', myPlayer);
  renderSlots('your-bans-slots', myPlayer.bans, 'ban', 3);
  renderSlots('your-protects-slots', myPlayer.protects, 'protect', 2);

  // Render right panel (opponent's/loser's characters)
  renderCharacterList('opponent-characters-list', oppPlayer);
  renderSlots('opponent-bans-slots', oppPlayer.bans, 'ban', 3);
  renderSlots('opponent-protects-slots', oppPlayer.protects, 'protect', 2);

  // Action area
  const actionArea = $('action-area');
  const waitingArea = $('waiting-area');

  if (isAdminView || !currentTurn) {
    actionArea.classList.add('hidden');
    waitingArea.classList.remove('hidden');
    if (isAdminView) {
      waitingArea.querySelector('p')!.textContent = '👁️ Spectating...';
    }
    return;
  }

  const isMyTurn = currentTurn.userId === state.mySocketId;

  if (isMyTurn) {
    actionArea.classList.remove('hidden');
    waitingArea.classList.add('hidden');
    renderBanActions(currentTurn.action, myPlayer, oppPlayer);
  } else {
    actionArea.classList.add('hidden');
    waitingArea.classList.remove('hidden');
    waitingArea.querySelector('p')!.textContent = 'Waiting for opponent...';
  }

  // Render turn history
  renderTurnHistory(bp, room);
}

function renderCharacterList(containerId: string, player: PlayerState): void {
  const container = $(containerId);
  container.innerHTML = player.selectedCharacters.map(chId => {
    const isBanned = player.bans.includes(chId);
    const isProtected = player.protects.includes(chId);
    const cls = isBanned ? 'banned' : isProtected ? 'protected' : '';
    return `
      <div class="char-mini ${cls}">
        <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
        <div class="char-mini-name">${charName(chId)}</div>
      </div>
    `;
  }).join('');
}

function renderSlots(containerId: string, items: string[], type: 'ban' | 'protect', total: number): void {
  const container = $(containerId);
  let html = '';
  for (let i = 0; i < total; i++) {
    if (items[i]) {
      html += `<div class="slot-icon filled ${type}"><img src="${charIconUrl(items[i])}" alt="${charName(items[i])}"></div>`;
    } else {
      html += `<div class="slot-icon">?</div>`;
    }
  }
  container.innerHTML = html;
}

function renderBanActions(action: string, myPlayer: PlayerState, oppPlayer: PlayerState): void {
  const banSection = $('ban-section');
  const protectSection = $('protect-section');
  const confirmBtn = $('btn-confirm-action') as HTMLButtonElement;

  // Ban targets: opponent's characters that are not already banned and not protected
  const banTargets = oppPlayer.selectedCharacters.filter(chId =>
    !oppPlayer.bans.includes(chId) && !oppPlayer.protects.includes(chId)
  );

  $('ban-target-list').innerHTML = banTargets.map(chId => `
    <div class="action-char ${state.banChoice === chId ? 'selected-ban' : ''}" data-action="ban" data-char-id="${chId}">
      <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
      <div class="char-mini-name">${charName(chId)}</div>
    </div>
  `).join('');

  // Protect targets: my characters that are not already protected and not already banned
  if (action === 'ban_and_protect') {
    protectSection.classList.remove('hidden');
    const protectTargets = myPlayer.selectedCharacters.filter(chId =>
      !myPlayer.protects.includes(chId) && !myPlayer.bans.includes(chId)
    );

    $('protect-target-list').innerHTML = protectTargets.map(chId => `
      <div class="action-char ${state.protectChoice === chId ? 'selected-protect' : ''}" data-action="protect" data-char-id="${chId}">
        <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
        <div class="char-mini-name">${charName(chId)}</div>
      </div>
    `).join('');
  } else {
    protectSection.classList.add('hidden');
    state.protectChoice = null;
  }

  // Update labels
  $('ban-choice-label').textContent = state.banChoice ? charName(state.banChoice) : 'None';
  $('protect-choice-label').textContent = state.protectChoice ? charName(state.protectChoice) : 'None';

  // Click handlers
  document.querySelectorAll('#ban-target-list .action-char').forEach(el => {
    el.addEventListener('click', () => {
      const chId = (el as HTMLElement).dataset.charId!;
      state.banChoice = state.banChoice === chId ? null : chId;
      renderBanPhase();
    });
  });

  document.querySelectorAll('#protect-target-list .action-char').forEach(el => {
    el.addEventListener('click', () => {
      const chId = (el as HTMLElement).dataset.charId!;
      state.protectChoice = state.protectChoice === chId ? null : chId;
      renderBanPhase();
    });
  });

  // Confirm button logic
  if (action === 'ban_and_protect') {
    confirmBtn.disabled = !state.banChoice || !state.protectChoice;
  } else {
    confirmBtn.disabled = !state.banChoice;
  }
}

function renderTurnHistory(bp: BanPhaseState, room: RoomState): void {
  const container = $('history-entries');
  const completedTurns = bp.turns.slice(0, bp.currentTurn);
  if (completedTurns.length === 0) {
    container.innerHTML = '<div style="text-align:center; color: var(--text-muted); font-size: 0.9rem;">No actions yet</div>';
    return;
  }

  container.innerHTML = completedTurns.map((turn, i) => {
    const player = room.players.find(p => p.id === turn.userId);
    const actions: string[] = [];
    if (turn.banChoice) actions.push(`🚫 Banned: ${charName(turn.banChoice)}`);
    if (turn.protectChoice) actions.push(`🛡️ Protected: ${charName(turn.protectChoice)}`);
    return `
      <div class="history-entry">
        <span class="history-turn-num">#${i + 1}</span>
        <span class="history-player">${player?.username || '?'}</span>
        <span class="history-actions">${actions.join(' &nbsp;│&nbsp; ')}</span>
      </div>
    `;
  }).join('');
}

// Confirm ban/protect action button
$('btn-confirm-action').addEventListener('click', () => {
  socket.emit('banProtectAction', {
    ban: state.banChoice,
    protect: state.protectChoice,
  }, (res: { success: boolean; error?: string }) => {
    if (res.success) {
      toast('Action confirmed!', 'success');
    } else {
      toast(res.error || 'Action failed', 'error');
    }
  });
});

// ═══════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════

function renderResults(): void {
  const room = state.room!;
  const nonAdmins = getNonAdmins();
  if (nonAdmins.length < 2) return;

  const p1 = nonAdmins[0];
  const p2 = nonAdmins[1];

  $('results-p1-name').textContent = p1.username;
  $('results-p2-name').textContent = p2.username;

  renderResultsPlayer('results-p1-bans', 'results-p1-protects', 'results-p1-remaining', p1);
  renderResultsPlayer('results-p2-bans', 'results-p2-protects', 'results-p2-remaining', p2);
}

function renderResultsPlayer(bansId: string, protectsId: string, remainingId: string, player: PlayerState): void {
  // Banned characters
  $(bansId).innerHTML = player.bans.map(chId => `
    <div class="result-char banned">
      <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
      <div class="result-char-name">${charName(chId)}</div>
    </div>
  `).join('') || '<p style="color: var(--text-muted);">None</p>';

  // Protected characters
  $(protectsId).innerHTML = player.protects.map(chId => `
    <div class="result-char protected">
      <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
      <div class="result-char-name">${charName(chId)}</div>
    </div>
  `).join('') || '<p style="color: var(--text-muted);">None</p>';

  // Remaining (not banned) characters
  const remaining = player.selectedCharacters.filter(chId => !player.bans.includes(chId));
  $(remainingId).innerHTML = remaining.map(chId => `
    <div class="result-char remaining">
      <img src="${charIconUrl(chId)}" alt="${charName(chId)}">
      <div class="result-char-name">${charName(chId)}</div>
    </div>
  `).join('') || '<p style="color: var(--text-muted);">None</p>';
}

// ═══════════════════════════════════════════
// Phase Router
// ═══════════════════════════════════════════

function renderCurrentPhase(): void {
  if (!state.room) return;
  switch (state.room.phase) {
    case 'lobby': renderLobby(); break;
    case 'selection': renderSelection(); break;
    case 'banPhase': renderBanPhase(); break;
    case 'results': renderResults(); break;
  }
}
