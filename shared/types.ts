// ═══════════════════════════════════════════
// Shared Types — Arena Ban System
// ═══════════════════════════════════════════

export interface Character {
  id: string;
  name: string;
  icon: string; // URL path to the icon
}

export type RoomPhase = 'lobby' | 'selection' | 'coinToss' | 'banPhase' | 'results';

export type BanTurnAction = 'ban_and_protect' | 'ban_only';

export interface BanTurn {
  userId: string;
  action: BanTurnAction;
  label: string;
  banChoice?: string;    // character id that was banned
  protectChoice?: string; // character id that was protected
}

export interface BanPhaseState {
  currentTurn: number;
  turns: BanTurn[];
  completed: boolean;
}

export interface PlayerState {
  id: string;
  username: string;
  isAdmin: boolean;
  ready: boolean;
  selectedCharacters: string[]; // character ids
  bans: string[];               // character ids banned ON this player
  protects: string[];            // character ids this player protected
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  players: PlayerState[];
  adminId: string;
  coinTossWinner: string | null;
  coinTossLoser: string | null;
  banPhase: BanPhaseState | null;
  availableCharacters: Character[];
}

// ── Socket Events: Client → Server ──

export interface CreateRoomPayload {
  username: string;
}

export interface JoinRoomPayload {
  code: string;
  username: string;
}

export interface SelectCharactersPayload {
  characters: string[];
}

export interface BanProtectActionPayload {
  ban: string | null;
  protect: string | null;
}

export interface ServerCallback<T = unknown> {
  (response: { success: boolean; error?: string } & T): void;
}

// ── Socket Events: Server → Client ──

export interface PhaseChangePayload {
  phase: RoomPhase;
  room: RoomState;
  winner?: string;
  loser?: string;
}

export interface BanPhaseUpdatePayload {
  currentTurn: number;
  turns: BanTurn[];
  room: RoomState;
}

export interface PlayerDisconnectedPayload {
  username: string;
}
