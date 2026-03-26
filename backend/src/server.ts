import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import type {
  Character,
  RoomState,
  RoomPhase,
  PlayerState,
  BanPhaseState,
  BanTurn,
  CreateRoomPayload,
  JoinRoomPayload,
  SelectCharactersPayload,
  BanProtectActionPayload,
  PhaseChangePayload,
  BanPhaseUpdatePayload,
} from '../../shared/types';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'https://ban-system-two.vercel.app',
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: 'https://ban-system-two.vercel.app' }));
app.use(express.json());

// ── Serve Icons statically ──
const iconsDir = path.join(__dirname, '..', '..', 'Icons');
app.use('/icons', express.static(iconsDir));

// ── Load available characters from Icons folder ──
function loadCharacters(): Character[] {
  try {
    const files = fs.readdirSync(iconsDir).filter(f =>
      /\.(png|jpg|jpeg|webp|svg)$/i.test(f)
    );
    return files.map(f => {
      const id = f.replace(/\.[^.]+$/, '');
      const name = id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return { id, name, icon: `/icons/${f}` };
    });
  } catch (e) {
    console.error('Could not read Icons directory:', (e as Error).message);
    return [];
  }
}

let AVAILABLE_CHARACTERS = loadCharacters();
console.log(`Loaded ${AVAILABLE_CHARACTERS.length} characters:`, AVAILABLE_CHARACTERS.map(c => c.name));

// ── API: get characters list ──
app.get('/api/characters', (_req, res) => {
  // Reload every time so new icons are picked up without restart
  AVAILABLE_CHARACTERS = loadCharacters();
  res.json(AVAILABLE_CHARACTERS);
});

// ═══════════════════════════════════════════
// Room Management
// ═══════════════════════════════════════════

interface Room {
  code: string;
  phase: RoomPhase;
  players: PlayerState[];
  adminId: string;
  coinTossWinner: string | null;
  coinTossLoser: string | null;
  banPhase: BanPhaseState | null;
}

const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function getRoomState(room: Room): RoomState {
  // Always reload characters from disk so newly added icons are picked up
  AVAILABLE_CHARACTERS = loadCharacters();
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map(p => ({ ...p })),
    adminId: room.adminId,
    coinTossWinner: room.coinTossWinner,
    coinTossLoser: room.coinTossLoser,
    banPhase: room.banPhase ? { ...room.banPhase, turns: room.banPhase.turns.map(t => ({ ...t })) } : null,
    availableCharacters: AVAILABLE_CHARACTERS,
  };
}

// ═══════════════════════════════════════════
// Socket.IO
// ═══════════════════════════════════════════

interface SocketData {
  roomCode?: string;
}

io.on('connection', (socket) => {
  console.log(`✦ Connected: ${socket.id}`);
  const data: SocketData = {};

  // ── Create Room ──
  socket.on('createRoom', ({ username }: CreateRoomPayload, callback) => {
    const code = generateRoomCode();
    const room: Room = {
      code,
      phase: 'lobby',
      players: [{
        id: socket.id,
        username,
        isAdmin: true,
        ready: false,
        selectedCharacters: [],
        bans: [],
        protects: [],
      }],
      adminId: socket.id,
      coinTossWinner: null,
      coinTossLoser: null,
      banPhase: null,
    };

    rooms.set(code, room);
    socket.join(code);
    data.roomCode = code;

    callback({ success: true, room: getRoomState(room) });
    console.log(`🏰 Room ${code} created by "${username}"`);
  });

  // ── Join Room ──
  socket.on('joinRoom', ({ code, username }: JoinRoomPayload, callback) => {
    const room = rooms.get(code);
    if (!room) return callback({ success: false, error: 'Room not found' });
    if (room.phase !== 'lobby') return callback({ success: false, error: 'Room is already in progress' });

    const nonAdmins = room.players.filter(p => !p.isAdmin);
    if (nonAdmins.length >= 2) return callback({ success: false, error: 'Room is full (max 2 players)' });

    if (room.players.find(p => p.username === username)) {
      return callback({ success: false, error: 'Username already taken in this room' });
    }

    room.players.push({
      id: socket.id,
      username,
      isAdmin: false,
      ready: false,
      selectedCharacters: [],
      bans: [],
      protects: [],
    });

    socket.join(code);
    data.roomCode = code;

    callback({ success: true, room: getRoomState(room) });
    io.to(code).emit('roomUpdate', getRoomState(room));
    console.log(`🚪 "${username}" joined room ${code}`);
  });

  // ── Start Selection Phase (admin only) ──
  socket.on('startSelection', (callback) => {
    const room = data.roomCode ? rooms.get(data.roomCode) : undefined;
    if (!room) return callback({ success: false, error: 'Room not found' });
    if (room.adminId !== socket.id) return callback({ success: false, error: 'Only admin can start' });

    const nonAdmins = room.players.filter(p => !p.isAdmin);
    if (nonAdmins.length < 2) return callback({ success: false, error: 'Need 2 players to start' });

    room.phase = 'selection';
    const payload: PhaseChangePayload = { phase: 'selection', room: getRoomState(room) };
    io.to(room.code).emit('phaseChange', payload);
    callback({ success: true });
    console.log(`🎭 Room ${room.code}: Selection phase started`);
  });

  // ── Select Characters ──
  socket.on('selectCharacters', ({ characters }: SelectCharactersPayload, callback) => {
    const room = data.roomCode ? rooms.get(data.roomCode) : undefined;
    if (!room) return callback({ success: false, error: 'Room not found' });
    if (room.phase !== 'selection') return callback({ success: false, error: 'Not in selection phase' });

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return callback({ success: false, error: 'Player not found' });
    if (player.isAdmin) return callback({ success: false, error: 'Admin cannot select characters' });

    if (characters.length === 0) return callback({ success: false, error: 'Select at least 1 character' });

    player.selectedCharacters = characters;
    player.ready = true;
    callback({ success: true });
    io.to(room.code).emit('roomUpdate', getRoomState(room));

    // Check if both non-admin players are ready
    const nonAdmins = room.players.filter(p => !p.isAdmin);
    if (nonAdmins.every(p => p.ready)) {
      room.phase = 'coinToss';

      // Coin toss — random winner
      const winnerIdx = Math.random() < 0.5 ? 0 : 1;
      const winner = nonAdmins[winnerIdx];
      const loser = nonAdmins[1 - winnerIdx];
      room.coinTossWinner = winner.id;
      room.coinTossLoser = loser.id;

      // Build ban phase turns
      room.banPhase = {
        currentTurn: 0,
        turns: [
          { userId: winner.id, action: 'ban_and_protect', label: 'Ban 1 & Protect 1' },
          { userId: loser.id, action: 'ban_and_protect', label: 'Ban 1 & Protect 1' },
          { userId: winner.id, action: 'ban_and_protect', label: 'Ban 1 & Protect 1' },
          { userId: loser.id, action: 'ban_and_protect', label: 'Ban 1 & Protect 1' },
          { userId: winner.id, action: 'ban_only', label: 'Ban 1' },
          { userId: loser.id, action: 'ban_only', label: 'Ban 1' },
        ],
        completed: false,
      };

      setTimeout(() => {
        const payload: PhaseChangePayload = {
          phase: 'coinToss',
          room: getRoomState(room),
          winner: winner.username,
          loser: loser.username,
        };
        io.to(room.code).emit('phaseChange', payload);
      }, 500);

      console.log(`🎲 Room ${room.code}: Coin toss → "${winner.username}" bans first`);
    }
  });

  // ── Proceed to Ban Phase ──
  socket.on('proceedToBanPhase', () => {
    const room = data.roomCode ? rooms.get(data.roomCode) : undefined;
    if (!room || room.phase !== 'coinToss') return;

    room.phase = 'banPhase';
    const payload: PhaseChangePayload = { phase: 'banPhase', room: getRoomState(room) };
    io.to(room.code).emit('phaseChange', payload);
    console.log(`⚔️ Room ${room.code}: Ban phase started`);
  });

  // ── Ban / Protect Action ──
  socket.on('banProtectAction', ({ ban, protect }: BanProtectActionPayload, callback) => {
    const room = data.roomCode ? rooms.get(data.roomCode) : undefined;
    if (!room) return callback({ success: false, error: 'Room not found' });
    if (room.phase !== 'banPhase') return callback({ success: false, error: 'Not in ban phase' });

    const bp = room.banPhase!;
    const turn = bp.turns[bp.currentTurn];
    if (turn.userId !== socket.id) return callback({ success: false, error: 'Not your turn' });

    const player = room.players.find(p => p.id === socket.id)!;
    const opponent = room.players.find(p => !p.isAdmin && p.id !== socket.id)!;

    // ── Validate & apply ban ──
    if (ban) {
      if (!opponent.selectedCharacters.includes(ban)) {
        return callback({ success: false, error: "Character not in opponent's roster" });
      }
      if (opponent.protects.includes(ban)) {
        return callback({ success: false, error: 'Cannot ban a protected character' });
      }
      if (opponent.bans.includes(ban)) {
        return callback({ success: false, error: 'Character already banned' });
      }
      opponent.bans.push(ban);
    }

    // ── Validate & apply protect ──
    if (protect) {
      if (!player.selectedCharacters.includes(protect)) {
        return callback({ success: false, error: 'Character not in your roster' });
      }
      if (player.protects.includes(protect)) {
        return callback({ success: false, error: 'Character already protected' });
      }
      if (player.bans.includes(protect)) {
        return callback({ success: false, error: 'Cannot protect a banned character' });
      }
      player.protects.push(protect);
    }

    // Record choices
    turn.banChoice = ban ?? undefined;
    turn.protectChoice = protect ?? undefined;

    // Advance turn
    bp.currentTurn++;

    if (bp.currentTurn >= bp.turns.length) {
      bp.completed = true;
      room.phase = 'results';
      const payload: PhaseChangePayload = { phase: 'results', room: getRoomState(room) };
      io.to(room.code).emit('phaseChange', payload);
      console.log(`🏆 Room ${room.code}: Ban phase complete!`);
    } else {
      io.to(room.code).emit('roomUpdate', getRoomState(room));
      const update: BanPhaseUpdatePayload = {
        currentTurn: bp.currentTurn,
        turns: bp.turns.map(t => ({ ...t })),
        room: getRoomState(room),
      };
      io.to(room.code).emit('banPhaseUpdate', update);
    }

    callback({ success: true });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log(`✦ Disconnected: ${socket.id}`);
    const code = data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(code).emit('roomUpdate', getRoomState(room));
      io.to(code).emit('playerDisconnected', { username: player.username });

      if (room.players.length === 0) {
        rooms.delete(code);
        console.log(`🗑️ Room ${code} deleted (empty)`);
      }
    }
  });
});

// ═══════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════

const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, () => {
  console.log(`\n🚀 Backend running on http://localhost:${PORT}`);
  console.log(`📁 Icons served from: ${iconsDir}\n`);
});
