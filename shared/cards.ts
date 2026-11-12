export type ChickenCardType =
  | 'CRAZY_CHICKEN'
  | 'DOCTOR_CHICKEN'
  | 'SICK_CHICKEN'
  | 'GRUMPY_CHICKEN'
  | 'HANDSOME_CHICKEN'
  | 'TELESCOPE_CHICKEN'
  | 'DUMMY_CHICKEN'
  | 'ANGER_CHICKEN'
  | 'BUTT_ON_CHICKEN'
  | 'GIVE_CHICKEN'
  | 'MUSIC_CHICKEN'
  | 'NAKIT_CHICKEN'
  | 'BABY_CHICKEN'
  | 'BALLOON_CHICKEN';

export interface Card {
  id: string;
  type: ChickenCardType;
  name: string;
  description: string;
  variant: 1 | 2;
  livesRemaining?: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  isAlive: boolean;
  isFrozenNextTurn: boolean;
  sickLives: number;
}

export type GamePhase =
  | 'LOBBY'
  | 'ACTION_PHASE'
  | 'INTERRUPT_WINDOW'
  | 'TELESCOPE_REORDER'
  | 'REINSERT_CRAZY'
  | 'GAME_OVER';

export interface PendingAction {
  card: Card;
  sourcePlayerId: string;
  sourcePlayerName: string;
  targetPlayerId?: string;
  canceled: boolean;
  expiresAt: number;
}

export interface ClientGameState {
  roomId: string;
  phase: GamePhase;
  deckCount: number;
  crazyCount: number;
  discardPile: Card[];
  players: PublicPlayer[];
  myHand: Card[];
  turnPlayerId: string;
  drawsRequired: number;
  pendingAction: PendingAction | null;
  logs: string[];
  winnerName?: string;
}
