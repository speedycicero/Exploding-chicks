import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';
import { Card, ChickenCardType, GamePhase, PendingAction, ClientGameState } from '../shared/cards';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

interface ServerPlayer {
  id: string;
  name: string;
  hand: Card[];
  isAlive: boolean;
  isFrozenNextTurn: boolean;
  isBot?: boolean;
}

interface Room {
  id: string;
  phase: GamePhase;
  deck: Card[];
  discardPile: Card[];
  players: ServerPlayer[];
  turnIndex: number;
  drawsRequired: number;
  pendingAction: PendingAction | null;
  timer?: NodeJS.Timeout;
  botTimer?: NodeJS.Timeout;
  logs: string[];
  winnerName?: string;
}

const rooms = new Map<string, Room>();
const BOT_NAMES = ['🤖 CluckBot 3000', '🤖 RoboRooster', '🤖 CyberChick'];

function makeCard(type: ChickenCardType, name: string, description: string, variant: 1 | 2): Card {
  return {
    id: randomUUID(),
    type,
    name,
    description,
    variant,
    livesRemaining: type === 'SICK_CHICKEN' ? 3 : undefined,
  };
}

function buildDeck(playerCount: number): { hands: Card[][]; deck: Card[] } {
  const pool: Card[] = [];
  const specs: [ChickenCardType, string, string, number][] = [
    ['GRUMPY_CHICKEN', 'Grumpy Chicken', 'Opponent must draw 2 or 3 cards!', 4],
    ['HANDSOME_CHICKEN', 'Handsome Chicken', 'Model pose! View the top 3 cards.', 4],
    ['TELESCOPE_CHICKEN', 'Telescope Chicken', 'View and rearrange the top 3 cards!', 4],
    ['DUMMY_CHICKEN', 'Dummy Chicken', 'Steal 1 random card from an opponent!', 6],
    ['ANGER_CHICKEN', 'Anger Chicken', 'Opponent gets angry and loses their next turn!', 4],
    ['BUTT_ON_CHICKEN', 'Butt-On Chicken', 'Press the Butt-On! Cancel any card played!', 5],
    ['GIVE_CHICKEN', 'Give Chicken', 'Jump right out of this round!', 4],
    ['MUSIC_CHICKEN', 'Music Chicken', 'Sing a loud song and shuffle the deck!', 4],
    ['NAKIT_CHICKEN', 'Nakit Chicken', 'Opponent dies unless they have Doctor, Anger, or Sick Chicken!', 2],
    ['SICK_CHICKEN', 'Sick Chicken', '3-Life Shield! Blocks up to 3 hazards.', 2],
    ['BABY_CHICKEN', 'Baby Chicken', 'So cute it skips 1 required draw!', 4],
    ['BALLOON_CHICKEN', 'Balloon Chicken', 'Float out of danger! Ends your turn safely.', 4],
  ];

  for (const [type, name, desc, count] of specs) {
    for (let i = 0; i < count; i++) {
      pool.push(makeCard(type, name, desc, i % 2 === 0 ? 1 : 2));
    }
  }

  pool.sort(() => Math.random() - 0.5);

  const hands: Card[][] = [];
  for (let p = 0; p < playerCount; p++) {
    const hand = pool.splice(0, 6);
    hand.push(makeCard('DOCTOR_CHICKEN', 'Doctor Chicken', 'Saves your life when you draw Crazy Chicken!', p % 2 === 0 ? 1 : 2));
    hands.push(hand);
  }

  pool.push(makeCard('DOCTOR_CHICKEN', 'Doctor Chicken', 'Saves your life when you draw Crazy Chicken!', 1));
  pool.push(makeCard('DOCTOR_CHICKEN', 'Doctor Chicken', 'Saves your life when you draw Crazy Chicken!', 2));

  const bombCount = Math.max(1, playerCount - 1);
  for (let b = 0; b < bombCount; b++) {
    pool.push(makeCard('CRAZY_CHICKEN', 'Crazy Chicken', 'See that? You will DIE unless you have a Doctor!', b % 2 === 0 ? 1 : 2));
  }

  pool.sort(() => Math.random() - 0.5);
  return { hands, deck: pool };
}

function logEvent(room: Room, msg: string) {
  room.logs.unshift(msg);
  if (room.logs.length > 14) room.logs.pop();
}

function checkWinner(room: Room) {
  const alive = room.players.filter(p => p.isAlive);
  if (room.players.length > 1 && alive.length === 1) {
    room.phase = 'GAME_OVER';
    room.winnerName = alive[0].name;
    if (room.botTimer) clearTimeout(room.botTimer);
    logEvent(room, `🏆 ${alive[0].name} wins the game!`);
  }
}

function broadcastRoom(room: Room) {
  const turnPlayerId = room.players[room.turnIndex]?.id || '';
  const crazyCount = room.deck.filter(c => c.type === 'CRAZY_CHICKEN').length;

  for (const player of room.players) {
    if (player.isBot) continue;
    const state: ClientGameState = {
      roomId: room.id,
      phase: room.phase,
      deckCount: room.deck.length,
      crazyCount,
      discardPile: room.discardPile.slice(-5),
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        isAlive: p.isAlive,
        isFrozenNextTurn: p.isFrozenNextTurn,
        sickLives: p.hand.filter(c => c.type === 'SICK_CHICKEN').reduce((sum, c) => sum + (c.livesRemaining || 0), 0),
      })),
      myHand: player.hand,
      turnPlayerId,
      drawsRequired: room.drawsRequired,
      pendingAction: room.pendingAction,
      logs: room.logs,
      winnerName: room.winnerName,
    };
    io.to(player.id).emit('server:state', state);
  }
}

function advanceTurn(room: Room, keepDraws = false) {
  if (!keepDraws) room.drawsRequired = 1;
  const alive = room.players.filter(p => p.isAlive);
  if (alive.length <= 1 && room.players.length > 1) {
    checkWinner(room);
    return;
  }

  do {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
  } while (!room.players[room.turnIndex].isAlive);

  const nextP = room.players[room.turnIndex];
  if (nextP.isFrozenNextTurn) {
    nextP.isFrozenNextTurn = false;
    logEvent(room, `😡 ${nextP.name} was too angry to focus and skipped their turn!`);
    advanceTurn(room, keepDraws);
    return;
  }

  scheduleBotIfNeeded(room);
}

// 🤖 BOT AI ENGINE
function scheduleBotIfNeeded(room: Room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.phase !== 'ACTION_PHASE') return;

  const current = room.players[room.turnIndex];
  if (!current || !current.isBot || !current.isAlive) return;

  room.botTimer = setTimeout(() => {
    if (room.phase !== 'ACTION_PHASE' || room.players[room.turnIndex]?.id !== current.id) return;

    // 55% chance the bot plays a playable action card before drawing
    const playableIdx = current.hand.findIndex(
      c => !['DOCTOR_CHICKEN', 'SICK_CHICKEN', 'BUTT_ON_CHICKEN'].includes(c.type)
    );

    if (playableIdx !== -1 && Math.random() < 0.55) {
      const card = current.hand.splice(playableIdx, 1)[0];
      room.discardPile.push(card);

      // If bot plays Telescope Chicken, just shuffle top 3 automatically
      if (card.type === 'TELESCOPE_CHICKEN') {
        const top3 = room.deck.splice(0, 3).sort(() => Math.random() - 0.5);
        room.deck.unshift(...top3);
        logEvent(room, `🔭 ${current.name} peeked and rearranged the top 3 cards!`);
        broadcastRoom(room);
        scheduleBotIfNeeded(room);
        return;
      }

      room.phase = 'INTERRUPT_WINDOW';
      room.pendingAction = {
        card,
        sourcePlayerId: current.id,
        sourcePlayerName: current.name,
        canceled: false,
        expiresAt: Date.now() + 3200,
      };
      logEvent(room, `⚡ ${current.name} played ${card.name}! (3s for Butt-On Chicken...)`);
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => resolveAction(room), 3200);
      broadcastRoom(room);
      return;
    }

    // Otherwise, bot draws a card
    executeDrawCard(room, current);
  }, 1600);
}

function triggerBotInterruptCheck(room: Room) {
  if (!room.pendingAction || room.phase !== 'INTERRUPT_WINDOW') return;
  const botWithButtOn = room.players.find(
    p => p.isBot && p.isAlive && p.id !== room.pendingAction?.sourcePlayerId && p.hand.some(c => c.type === 'BUTT_ON_CHICKEN')
  );

  // 35% chance a bot slams Butt-On Chicken to cancel a human player's card
  if (botWithButtOn && Math.random() < 0.35) {
    setTimeout(() => {
      if (room.phase !== 'INTERRUPT_WINDOW' || !room.pendingAction) return;
      const idx = botWithButtOn.hand.findIndex(c => c.type === 'BUTT_ON_CHICKEN');
      if (idx === -1) return;
      const card = botWithButtOn.hand.splice(idx, 1)[0];
      room.discardPile.push(card);
      room.pendingAction.canceled = !room.pendingAction.canceled;
      room.pendingAction.expiresAt = Date.now() + 3000;
      logEvent(room, `🔴 ${botWithButtOn.name} slammed BUTT-ON CHICKEN!`);
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => resolveAction(room), 3000);
      broadcastRoom(room);
    }, 1100);
  }
}

function resolveAction(room: Room) {
  const action = room.pendingAction;
  room.pendingAction = null;
  room.phase = 'ACTION_PHASE';
  if (!action) return;

  if (action.canceled) {
    logEvent(room, `🔴 ${action.card.name} was CANCELED by Butt-On Chicken!`);
    broadcastRoom(room);
    scheduleBotIfNeeded(room);
    return;
  }

  const source = room.players.find(p => p.id === action.sourcePlayerId);
  if (!source) return;

  const opponents = room.players.filter(p => p.id !== source.id && p.isAlive);
  const target = room.players.find(p => p.id === action.targetPlayerId) || opponents[0] || source;

  switch (action.card.type) {
    case 'GRUMPY_CHICKEN': {
      const extra = Math.random() < 0.5 ? 2 : 3;
      room.drawsRequired = extra;
      logEvent(room, `😠 Grumpy Chicken! Next player must draw ${extra} cards!`);
      advanceTurn(room, true);
      break;
    }
    case 'HANDSOME_CHICKEN': {
      logEvent(room, `😎 ${source.name} struck a model pose and peeked at the top 3 cards!`);
      if (!source.isBot) io.to(source.id).emit('server:peek_cards', room.deck.slice(0, 3));
      break;
    }
    case 'TELESCOPE_CHICKEN': {
      if (source.isBot) {
        const top3 = room.deck.splice(0, 3).sort(() => Math.random() - 0.5);
        room.deck.unshift(...top3);
        logEvent(room, `🔭 ${source.name} rearranged the top 3 cards!`);
      } else {
        room.phase = 'TELESCOPE_REORDER';
        logEvent(room, `🔭 ${source.name} is rearranging the top 3 cards with Telescope Chicken!`);
        io.to(source.id).emit('server:reorder_cards', room.deck.slice(0, 3));
      }
      break;
    }
    case 'DUMMY_CHICKEN': {
      if (target && target.id !== source.id && target.hand.length > 0) {
        const randIdx = Math.floor(Math.random() * target.hand.length);
        const [stolen] = target.hand.splice(randIdx, 1);
        source.hand.push(stolen);
        logEvent(room, `🤪 ${source.name} used Dummy Chicken to steal a card from ${target.name}!`);
      } else {
        logEvent(room, `🤪 ${source.name} played Dummy Chicken... it stared blankly at a wall.`);
      }
      break;
    }
    case 'ANGER_CHICKEN': {
      if (target && target.id !== source.id) {
        target.isFrozenNextTurn = true;
        logEvent(room, `🔥 ${target.name} got hit by Anger Chicken and is out for their next round!`);
      }
      break;
    }
    case 'GIVE_CHICKEN':
    case 'BABY_CHICKEN': {
      room.drawsRequired -= 1;
      logEvent(room, `🐣 ${source.name} used ${action.card.name} to skip a draw!`);
      if (room.drawsRequired <= 0) advanceTurn(room);
      break;
    }
    case 'BALLOON_CHICKEN': {
      logEvent(room, `🎈 ${source.name} floated completely out of danger for this round!`);
      advanceTurn(room);
      break;
    }
    case 'MUSIC_CHICKEN': {
      room.deck.sort(() => Math.random() - 0.5);
      logEvent(room, `🎧 ${source.name}'s Music Chicken banged pots and shuffled the deck!`);
      break;
    }
    case 'NAKIT_CHICKEN': {
      if (!target || target.id === source.id) break;
      const defIdx = target.hand.findIndex(
        c => c.type === 'DOCTOR_CHICKEN' || c.type === 'ANGER_CHICKEN' || c.type === 'SICK_CHICKEN'
      );
      if (defIdx !== -1) {
        const defCard = target.hand[defIdx];
        if (defCard.type === 'SICK_CHICKEN' && (defCard.livesRemaining || 1) > 1) {
          defCard.livesRemaining! -= 1;
          logEvent(room, `🤒 ${target.name}'s Sick Chicken blocked Nakit Chicken! (${defCard.livesRemaining} lives left)`);
        } else {
          target.hand.splice(defIdx, 1);
          room.discardPile.push(defCard);
          logEvent(room, `🛡️ ${target.name} survived Nakit Chicken by discarding ${defCard.name}!`);
        }
      } else {
        target.isAlive = false;
        logEvent(room, `💀 ${target.name} had no defense against Nakit Chicken and exploded!`);
        checkWinner(room);
      }
      break;
    }
  }
  broadcastRoom(room);
  scheduleBotIfNeeded(room);
}

function executeDrawCard(room: Room, player: ServerPlayer) {
  const drawn = room.deck.shift();
  if (!drawn) return;

  if (drawn.type === 'CRAZY_CHICKEN') {
    logEvent(room, `💣 OH NO! ${player.name} drew CRAZY CHICKEN!`);
    const docIdx = player.hand.findIndex(c => c.type === 'DOCTOR_CHICKEN');
    const sickIdx = player.hand.findIndex(c => c.type === 'SICK_CHICKEN');

    if (docIdx !== -1 || sickIdx !== -1) {
      if (docIdx !== -1) {
        const doc = player.hand.splice(docIdx, 1)[0];
        room.discardPile.push(doc);
        logEvent(room, `💉 ${player.name}'s Doctor Chicken saved their life!`);
      } else {
        const sick = player.hand[sickIdx];
        if ((sick.livesRemaining || 1) > 1) {
          sick.livesRemaining! -= 1;
          logEvent(room, `🤒 ${player.name}'s Sick Chicken absorbed the blast! (${sick.livesRemaining} lives left)`);
        } else {
          player.hand.splice(sickIdx, 1);
          room.discardPile.push(sick);
          logEvent(room, `🤒 ${player.name}'s Sick Chicken used its last life to save them!`);
        }
      }

      // If a Bot survived, automatically hide Crazy Chicken at a random deck spot
      if (player.isBot) {
        const randIdx = Math.floor(Math.random() * (room.deck.length + 1));
        room.deck.splice(randIdx, 0, drawn);
        room.drawsRequired -= 1;
        logEvent(room, `🤖 ${player.name} secretly hid Crazy Chicken back into the deck!`);
        if (room.drawsRequired <= 0) advanceTurn(room);
        else scheduleBotIfNeeded(room);
      } else {
        room.phase = 'REINSERT_CRAZY';
      }
    } else {
      player.isAlive = false;
      room.discardPile.push(drawn);
      logEvent(room, `💥 ${player.name} had no Doctor or Sick Chicken and EXPLODED!`);
      checkWinner(room);
      if (room.phase !== 'GAME_OVER') advanceTurn(room);
    }
  } else {
    player.hand.push(drawn);
    room.drawsRequired -= 1;
    logEvent(room, `🃏 ${player.name} drew a safe card.`);
    if (room.drawsRequired <= 0) advanceTurn(room);
    else scheduleBotIfNeeded(room);
  }
  broadcastRoom(room);
}

io.on('connection', socket => {
  socket.on('client:join', ({ roomId, playerName }: { roomId: string; playerName: string }) => {
    const cleanRoom = (roomId || 'COOP1').toUpperCase();
    let room = rooms.get(cleanRoom);
    if (!room) {
      room = {
        id: cleanRoom,
        phase: 'LOBBY',
        deck: [],
        discardPile: [],
        players: [],
        turnIndex: 0,
        drawsRequired: 1,
        pendingAction: null,
        logs: [`Welcome to Room ${cleanRoom}! Add a Bot or invite a friend to start.`],
      };
      rooms.set(cleanRoom, room);
    }

    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({
        id: socket.id,
        name: playerName || `Player ${room.players.length + 1}`,
        hand: [],
        isAlive: true,
        isFrozenNextTurn: false,
      });
      logEvent(room, `🐔 ${playerName} joined the coop!`);
    }
    broadcastRoom(room);
  });

  // 🤖 Manual Add Bot button handler
  socket.on('client:add_bot', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'LOBBY') return;
    const botCount = room.players.filter(p => p.isBot).length;
    if (room.players.length >= 5) return;
    const botName = BOT_NAMES[botCount % BOT_NAMES.length];
    room.players.push({
      id: `bot-${randomUUID()}`,
      name: botName,
      hand: [],
      isAlive: true,
      isFrozenNextTurn: false,
      isBot: true,
    });
    logEvent(room, `${botName} entered the coop!`);
    broadcastRoom(room);
  });

  socket.on('client:start_game', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (!room || room.players.length === 0) return;

    // 🤖 AUTO-BOT MODE: If you're the only player in the room, automatically add a Bot!
    if (room.players.length === 1) {
      const botName = BOT_NAMES[0];
      room.players.push({
        id: `bot-${randomUUID()}`,
        name: botName,
        hand: [],
        isAlive: true,
        isFrozenNextTurn: false,
        isBot: true,
      });
      logEvent(room, `🤖 No other players found — ${botName} joined automatically!`);
    }

    const { hands, deck } = buildDeck(room.players.length);
    room.deck = deck;
    room.discardPile = [];
    room.phase = 'ACTION_PHASE';
    room.turnIndex = 0;
    room.drawsRequired = 1;
    room.winnerName = undefined;

    room.players.forEach((p, idx) => {
      p.isAlive = true;
      p.isFrozenNextTurn = false;
      p.hand = hands[idx];
    });

    logEvent(room, `🚀 Game started with ${room.players.length} players!`);
    broadcastRoom(room);
    scheduleBotIfNeeded(room);
  });

  socket.on('client:play_card', ({ roomId, cardId, targetPlayerId }: { roomId: string; cardId: string; targetPlayerId?: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isAlive) return;

    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
    const card = player.hand[cardIdx];

    if (card.type === 'BUTT_ON_CHICKEN') {
      if (room.phase !== 'INTERRUPT_WINDOW' || !room.pendingAction) return;
      player.hand.splice(cardIdx, 1);
      room.discardPile.push(card);
      room.pendingAction.canceled = !room.pendingAction.canceled;
      room.pendingAction.expiresAt = Date.now() + 3000;
      logEvent(room, `🔴 ${player.name} slammed BUTT-ON CHICKEN!`);
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => resolveAction(room), 3000);
      broadcastRoom(room);
      return;
    }

    if (room.phase !== 'ACTION_PHASE' || room.players[room.turnIndex]?.id !== socket.id) return;
    if (card.type === 'DOCTOR_CHICKEN' || card.type === 'SICK_CHICKEN') return;

    player.hand.splice(cardIdx, 1);
    room.discardPile.push(card);

    room.phase = 'INTERRUPT_WINDOW';
    room.pendingAction = {
      card,
      sourcePlayerId: player.id,
      sourcePlayerName: player.name,
      targetPlayerId,
      canceled: false,
      expiresAt: Date.now() + 3200,
    };

    logEvent(room, `⚡ ${player.name} played ${card.name}! (3s for Butt-On Chicken...)`);
    if (room.timer) clearTimeout(room.timer);
    room.timer = setTimeout(() => resolveAction(room), 3200);
    broadcastRoom(room);
    triggerBotInterruptCheck(room);
  });

  socket.on('client:submit_reorder', ({ roomId, cardIds }: { roomId: string; cardIds: string[] }) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'TELESCOPE_REORDER') return;
    const top3 = room.deck.splice(0, 3);
    const reordered = cardIds.map(id => top3.find(c => c.id === id)!).filter(Boolean);
    room.deck.unshift(...reordered);
    room.phase = 'ACTION_PHASE';
    logEvent(room, `🔭 Top 3 cards have been secretly rearranged!`);
    broadcastRoom(room);
  });

  socket.on('client:draw_card', ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'ACTION_PHASE') return;
    const player = room.players[room.turnIndex];
    if (!player || player.id !== socket.id) return;
    executeDrawCard(room, player);
  });

  socket.on('client:reinsert_crazy', ({ roomId, index }: { roomId: string; index: number }) => {
    const room = rooms.get(roomId);
    if (!room || room.phase !== 'REINSERT_CRAZY') return;
    const bomb = makeCard('CRAZY_CHICKEN', 'Crazy Chicken', 'See that? You will DIE unless you have a Doctor!', 1);
    const safeIdx = Math.max(0, Math.min(room.deck.length, index));
    room.deck.splice(safeIdx, 0, bomb);
    room.phase = 'ACTION_PHASE';
    room.drawsRequired -= 1;
    logEvent(room, `🤫 ${room.players[room.turnIndex]?.name} secretly hid Crazy Chicken back in the deck!`);
    if (room.drawsRequired <= 0) advanceTurn(room);
    broadcastRoom(room);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Exploding Chickens Server (with Bot AI) running on port ${PORT}`);
});
