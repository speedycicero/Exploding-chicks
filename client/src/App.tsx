import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { Card, ClientGameState } from './cards';

const socket: Socket = io('http://localhost:3001');

// Maps each card type to its (col, row) position on the 4x4 card sheet
const CARD_SPRITES: Record<string, { col: number; row: number; bg1: string; bg2: string }> = {
  GRUMPY_CHICKEN:    { col: 0, row: 0, bg1: '#fecaca', bg2: '#fca5a5' },
  HANDSOME_CHICKEN:  { col: 1, row: 0, bg1: '#bfdbfe', bg2: '#93c5fd' },
  DUMMY_CHICKEN:     { col: 2, row: 0, bg1: '#fef08a', bg2: '#fde047' },
  TELESCOPE_CHICKEN: { col: 3, row: 0, bg1: '#ddd6fe', bg2: '#c4b5fd' },
  ANGER_CHICKEN:     { col: 0, row: 1, bg1: '#fed7aa', bg2: '#fdba74' },
  BUTT_ON_CHICKEN:   { col: 1, row: 1, bg1: '#f5d0fe', bg2: '#f0abfc' },
  CRAZY_CHICKEN:     { col: 2, row: 1, bg1: '#ef4444', bg2: '#dc2626' },
  GIVE_CHICKEN:      { col: 3, row: 1, bg1: '#bbf7d0', bg2: '#86efac' },
  MUSIC_CHICKEN:     { col: 1, row: 2, bg1: '#99f6e4', bg2: '#5eead4' },
  NAKIT_CHICKEN:     { col: 2, row: 2, bg1: '#fbcfe8', bg2: '#f9a8d4' },
  SICK_CHICKEN:      { col: 0, row: 3, bg1: '#d9f99d', bg2: '#bef264' },
  BABY_CHICKEN:      { col: 1, row: 3, bg1: '#fde68a', bg2: '#fcd34d' },
  BALLOON_CHICKEN:   { col: 2, row: 3, bg1: '#bae6fd', bg2: '#7dd3fc' },
  DOCTOR_CHICKEN:    { col: 3, row: 3, bg1: '#a7f3d0', bg2: '#6ee7b7' },
};

const USERS_NOTE_RULES = [
  { name: '1. Grumpy Chicken', rule: 'Forces the next player to draw 2 or 3 cards!' },
  { name: '2. Handsome Chicken', rule: 'Strikes a model pose so you can secretly view the top 3 cards.' },
  { name: '3. Dummy Chicken', rule: 'Play to steal 1 random card from an opponent.' },
  { name: '4. Anger Chicken', rule: 'Makes opponent angry so they lose focus and skip their next round!' },
  { name: '5. Butt-On Chicken', rule: 'Play at ANY time during the 3-second countdown to cancel an action!' },
  { name: '5b. Give Chicken', rule: 'Jump right out of this round without drawing a card.' },
  { name: '6. Crazy Chicken', rule: 'See that? You will DIE unless you have a Doctor or Sick Chicken!' },
  { name: '7. Music Chicken', rule: 'Bangs pots and pans to shuffle the draw deck.' },
  { name: '8. Nakit Chicken', rule: 'Opponent dies unless they discard a Doctor, Anger, or Sick Chicken!' },
  { name: '9. Sick Chicken', rule: 'Passive 3-Life Shield that automatically blocks hazards.' },
  { name: '10. Baby Chicken', rule: 'So cute it skips 1 required card draw.' },
  { name: '11. Balloon Chicken', rule: 'Floats you completely out of danger and ends your turn safely.' },
  { name: '12. Doctor Chicken', rule: 'Saves your life when you draw Crazy Chicken and lets you hide it back in the deck!' },
  { name: '13. Telescope Chicken', rule: 'See the top 3 cards of the deck AND rearrange their order!' },
];

function ChickenArtwork({ card }: { card: Card }) {
  const sprite = CARD_SPRITES[card.type] || { col: 0, row: 0 };
  const posX = (sprite.col / 3) * 100;
  const posY = (sprite.row / 3) * 100;
  const isVariant2 = card.variant === 2;

  return (
    <div
      style={{
        width: '100%',
        height: 105,
        borderRadius: 8,
        border: '2px solid rgba(0,0,0,0.2)',
        backgroundImage: 'url("/chickens-sheet.jpg")',
        backgroundSize: '420% 420%',
        backgroundPosition: `${posX}% ${posY}%`,
        backgroundRepeat: 'no-repeat',
        transform: isVariant2 ? 'scaleX(-1)' : 'none',
        filter: isVariant2 ? 'hue-rotate(25deg) contrast(1.08)' : 'none',
      }}
    />
  );
}

export default function App() {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('COOP1');
  const [joined, setJoined] = useState(false);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [peekCards, setPeekCards] = useState<Card[] | null>(null);
  const [reorderCards, setReorderCards] = useState<Card[] | null>(null);
  const [showUsersNote, setShowUsersNote] = useState(false);
  const [insertPos, setInsertPos] = useState(0);
  const [connected, setConnected] = useState(socket.connected);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('server:state', (state: ClientGameState) => {
      setGameState(state);
      setJoining(false);
    });
    socket.on('server:peek_cards', (cards: Card[]) => setPeekCards(cards));
    socket.on('server:reorder_cards', (cards: Card[]) => setReorderCards(cards));

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('server:state');
      socket.off('server:peek_cards');
      socket.off('server:reorder_cards');
    };
  }, []);

  // 1. ANIMATED TITLE & LOADING SCREEN
  if (!joined || !gameState) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'radial-gradient(circle at top, #7f1d1d 0%, #1e1b4b 55%, #090d16 100%)',
          color: 'white',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 20,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <style>{`
          @keyframes bounceChicken {
            0%, 100% { transform: translateY(0) rotate(-3deg); }
            50% { transform: translateY(-10px) rotate(3deg); }
          }
          @keyframes pulseGlow {
            0%, 100% { box-shadow: 0 0 25px rgba(245, 158, 11, 0.4); }
            50% { box-shadow: 0 0 45px rgba(239, 68, 68, 0.8); }
          }
        `}</style>

        {/* Top Server Status Pill */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            background: 'rgba(15, 23, 42, 0.85)',
            border: '2px solid #334155',
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              display: 'inline-block',
            }}
          />
          {connected ? 'Coop Server Online' : 'Connecting to Server...'}
        </div>

        {/* Floating Chicken Card Art Showcase */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 20 }}>
          {[
            { col: 2, row: 1 }, // Crazy Chicken
            { col: 0, row: 0 }, // Grumpy Chicken
            { col: 3, row: 3 }, // Doctor Chicken
          ].map((item, idx) => (
            <div
              key={idx}
              style={{
                width: 82,
                height: 82,
                borderRadius: 16,
                border: '3px solid #000',
                backgroundImage: 'url("/chickens-sheet.jpg")',
                backgroundSize: '420% 420%',
                backgroundPosition: `${(item.col / 3) * 100}% ${(item.row / 3) * 100}%`,
                animation: `bounceChicken 2.2s ease-in-out ${idx * 0.3}s infinite`,
                boxShadow: '0 10px 20px rgba(0,0,0,0.5)',
              }}
            />
          ))}
        </div>

        {/* Main Title Card */}
        <div
          style={{
            background: '#1e293b',
            padding: '32px 28px',
            borderRadius: 24,
            border: '4px solid #000',
            width: '100%',
            maxWidth: 400,
            textAlign: 'center',
            animation: 'pulseGlow 3s infinite',
          }}
        >
          <div
            style={{
              display: 'inline-block',
              background: '#ef4444',
              color: '#fff',
              fontWeight: 900,
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 999,
              border: '2px solid #000',
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            CHAOTIC MULTIPLAYER EDITION
          </div>

          <h1 style={{ fontSize: 34, fontWeight: 900, margin: '0 0 6px 0', letterSpacing: -0.5 }}>
            EXPLODING CHICKS
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 22 }}>
            Draw cards. Dodge the Crazy Chicken. Slam the Butt-On!
          </p>

          <div style={{ textAlign: 'left', marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold', color: '#cbd5e1', display: 'block', marginBottom: 4 }}>
              PLAYER NAME
            </label>
            <input
              placeholder="Enter your name..."
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && playerName.trim() && connected) {
                  setJoining(true);
                  socket.emit('client:join', { roomId, playerName });
                  setJoined(true);
                }
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 12,
                borderRadius: 10,
                border: '3px solid #000',
                fontSize: 15,
                fontWeight: 'bold',
                background: '#f8fafc',
                color: '#0f172a',
              }}
            />
          </div>

          <div style={{ textAlign: 'left', marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold', color: '#cbd5e1', display: 'block', marginBottom: 4 }}>
              COOP ROOM CODE
            </label>
            <input
              placeholder="COOP1"
              value={roomId}
              onChange={e => setRoomId(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 12,
                borderRadius: 10,
                border: '3px solid #000',
                fontSize: 15,
                fontWeight: 'bold',
                background: '#f8fafc',
                color: '#0f172a',
                letterSpacing: 2,
              }}
            />
          </div>

          <button
            disabled={!connected || joining}
            onClick={() => {
              if (!playerName.trim()) return;
              setJoining(true);
              socket.emit('client:join', { roomId, playerName });
              setJoined(true);
            }}
            style={{
              width: '100%',
              padding: 14,
              background: connected ? '#f59e0b' : '#64748b',
              color: '#000',
              fontWeight: 900,
              fontSize: 16,
              borderRadius: 12,
              border: '3px solid #000',
              cursor: connected ? 'pointer' : 'not-allowed',
              marginBottom: 10,
            }}
          >
            {joining ? '🥚 Entering Coop...' : '🐔 ENTER THE COOP'}
          </button>

          <button
            onClick={() => setShowUsersNote(true)}
            style={{
              width: '100%',
              padding: 10,
              background: '#fde047',
              color: '#000',
              fontWeight: 'bold',
              fontSize: 13,
              borderRadius: 10,
              border: '2px solid #000',
              cursor: 'pointer',
            }}
          >
            📜 Read Card Rules (User's Note)
          </button>
        </div>

        {/* User's Note Popup on Title Screen */}
        {showUsersNote && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
            <div style={{ background: '#fef9c3', color: '#000', padding: 24, borderRadius: 16, border: '4px solid #000', maxWidth: 540, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
              <h2 style={{ marginTop: 0 }}>📜 Official Chicken User's Note</h2>
              {USERS_NOTE_RULES.map((item, idx) => (
                <div key={idx} style={{ marginBottom: 8, borderBottom: '1px dashed #a16207', paddingBottom: 6 }}>
                  <strong>{item.name}:</strong> <span>{item.rule}</span>
                </div>
              ))}
              <button
                onClick={() => setShowUsersNote(false)}
                style={{ marginTop: 12, width: '100%', padding: 10, background: '#000', color: '#fff', fontWeight: 'bold', borderRadius: 8, cursor: 'pointer' }}
              >
                Got It! Back to Title Screen
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. MAIN MULTIPLAYER GAME TABLE
  const isMyTurn = gameState.turnPlayerId === socket.id;
  const topDiscard = gameState.discardPile[gameState.discardPile.length - 1];

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: 'white', padding: 20, fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      {/* Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '12px 20px', borderRadius: 14, border: '3px solid #000' }}>
        <div>
          <strong style={{ fontSize: 18 }}>🐔 Room: {gameState.roomId}</strong>
          <span style={{ marginLeft: 16, fontSize: 14, color: '#94a3b8' }}>
            Deck: {gameState.deckCount} cards ({gameState.crazyCount} Crazy Chickens left)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowUsersNote(true)}
            style={{ padding: '8px 14px', background: '#fde047', color: '#000', fontWeight: 'bold', borderRadius: 8, border: '2px solid #000', cursor: 'pointer' }}
          >
            📜 User's Note (Card Rules)
          </button>
          {(gameState.phase === 'LOBBY' || gameState.phase === 'GAME_OVER') && (
            <button
              onClick={() => socket.emit('client:start_game', { roomId: gameState.roomId })}
              style={{ padding: '8px 16px', background: '#22c55e', color: '#000', fontWeight: 'bold', borderRadius: 8, border: '2px solid #000', cursor: 'pointer' }}
            >
              ▶ {gameState.phase === 'GAME_OVER' ? 'Play Again' : 'Start Game'}
            </button>
          )}
        </div>
      </div>

      {/* Winner Banner */}
      {gameState.phase === 'GAME_OVER' && (
        <div style={{ background: '#eab308', color: '#000', padding: 16, borderRadius: 14, border: '4px solid #000', textAlign: 'center', fontSize: 22, fontWeight: 900, marginTop: 12 }}>
          🏆 {gameState.winnerName} IS THE LAST CHICKEN STANDING! 🏆
        </div>
      )}

      {/* Players Row */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        {gameState.players.map(p => (
          <div
            key={p.id}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: p.id === gameState.turnPlayerId ? '3px solid #facc15' : '2px solid #334155',
              background: !p.isAlive ? '#450a0a' : p.id === gameState.turnPlayerId ? '#1e3a8a' : '#1e293b',
              opacity: p.isAlive ? 1 : 0.6,
            }}
          >
            <div style={{ fontWeight: 'bold' }}>
              {p.name} {p.id === socket.id ? '(You)' : ''} {!p.isAlive ? '💀' : ''}
            </div>
            <div style={{ fontSize: 12, color: '#cbd5e1' }}>
              🃏 {p.handCount} cards {p.sickLives > 0 ? `| 🤒 ${p.sickLives} Shield` : ''} {p.isFrozenNextTurn ? '| 😡 Angry' : ''}
            </div>
          </div>
        ))}
      </div>

      {/* Center Table: Draw Pile, Discard Pile & Activity Log */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 40, margin: '20px 0', flexWrap: 'wrap' }}>
        {/* Draw Pile */}
        <div
          onClick={() => isMyTurn && gameState.phase === 'ACTION_PHASE' && socket.emit('client:draw_card', { roomId: gameState.roomId })}
          style={{
            width: 155,
            height: 225,
            background: isMyTurn && gameState.phase === 'ACTION_PHASE' ? '#f59e0b' : '#475569',
            color: '#000',
            borderRadius: 16,
            border: '4px solid #000',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isMyTurn ? 'pointer' : 'not-allowed',
            textAlign: 'center',
            padding: 12,
            fontWeight: 'bold',
          }}
        >
          <div style={{ fontSize: 42 }}>🥚</div>
          <div>DRAW PILE</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>{gameState.deckCount} left</div>
          {isMyTurn && <div style={{ fontSize: 11, marginTop: 8, background: '#fff', padding: '2px 8px', borderRadius: 6 }}>Click to Draw ({gameState.drawsRequired} left)</div>}
        </div>

        {/* Discard Pile */}
        <div
          style={{
            width: 155,
            height: 225,
            background: topDiscard ? CARD_SPRITES[topDiscard.type]?.bg1 || '#fff' : '#1e293b',
            color: '#000',
            borderRadius: 16,
            border: '4px dashed #64748b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 10,
            textAlign: 'center',
          }}
        >
          {topDiscard ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 'bold' }}>{topDiscard.name} (#{topDiscard.variant})</div>
              <ChickenArtwork card={topDiscard} />
              <div style={{ fontSize: 10, fontWeight: 600 }}>{topDiscard.description}</div>
            </>
          ) : (
            <span style={{ color: '#94a3b8', fontSize: 13, margin: 'auto' }}>Discard Pile Empty</span>
          )}
        </div>

        {/* Activity Log */}
        <div style={{ width: 300, height: 225, background: '#1e293b', borderRadius: 14, padding: 12, overflowY: 'auto', border: '2px solid #334155', fontSize: 12 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 6, color: '#fde047' }}>📢 Coop Activity Log:</div>
          {gameState.logs.map((l, i) => (
            <div key={i} style={{ marginBottom: 4, borderBottom: '1px solid #334155', paddingBottom: 3 }}>{l}</div>
          ))}
        </div>
      </div>

      {/* Butt-On Chicken Interrupt Banner */}
      {gameState.phase === 'INTERRUPT_WINDOW' && gameState.pendingAction && (
        <div style={{ background: '#dc2626', padding: 14, borderRadius: 12, textAlign: 'center', border: '3px solid #000', marginBottom: 12 }}>
          <strong>⚡ {gameState.pendingAction.sourcePlayerName} played {gameState.pendingAction.card.name}!</strong>
          <span style={{ marginLeft: 10 }}>
            Status: {gameState.pendingAction.canceled ? '🚫 CANCELED!' : '✅ GOING TO HAPPEN'} — Click your <b>BUTT-ON CHICKEN</b> now to flip it!
          </span>
        </div>
      )}

      {/* Re-insert Crazy Chicken Prompt */}
      {gameState.phase === 'REINSERT_CRAZY' && isMyTurn && (
        <div style={{ background: '#7f1d1d', padding: 16, borderRadius: 12, textAlign: 'center', border: '3px solid #000', marginBottom: 12 }}>
          <strong>💉 You survived Crazy Chicken! Pick where to hide it in the deck (0 = Top, {gameState.deckCount} = Bottom):</strong>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', gap: 10 }}>
            <input
              type="number"
              min={0}
              max={gameState.deckCount}
              value={insertPos}
              onChange={e => setInsertPos(Number(e.target.value))}
              style={{ width: 70, padding: 6, borderRadius: 6, color: '#000' }}
            />
            <button
              onClick={() => socket.emit('client:reinsert_crazy', { roomId: gameState.roomId, index: insertPos })}
              style={{ padding: '6px 14px', background: '#22c55e', color: '#000', fontWeight: 'bold', borderRadius: 6, cursor: 'pointer' }}
            >
              Hide Crazy Chicken
            </button>
          </div>
        </div>
      )}

      {/* My Hand */}
      <div>
        <div style={{ textAlign: 'center', marginBottom: 8, fontWeight: 'bold', color: isMyTurn ? '#4ade80' : '#94a3b8' }}>
          {isMyTurn ? '👉 YOUR TURN! Play cards or click the Draw Pile to end your turn.' : '⏳ Waiting for current player...'}
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: '10px 4px', justifyContent: 'center' }}>
          {gameState.myHand.map(card => {
            const vis = CARD_SPRITES[card.type] || { bg1: '#fff', bg2: '#eee' };
            const bg = card.variant === 1 ? vis.bg1 : vis.bg2;
            return (
              <div
                key={card.id}
                onClick={() => socket.emit('client:play_card', { roomId: gameState.roomId, cardId: card.id })}
                style={{
                  minWidth: 145,
                  maxWidth: 145,
                  height: 215,
                  background: bg,
                  color: '#000',
                  borderRadius: 14,
                  border: '3px solid #000',
                  padding: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 'bold' }}>
                  <span>{card.name}</span>
                  <span>#{card.variant}</span>
                </div>
                <ChickenArtwork card={card} />
                <div style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', background: 'rgba(255,255,255,0.85)', padding: 4, borderRadius: 6 }}>
                  {card.description}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Handsome Chicken Peek Modal */}
      {peekCards && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#1e293b', padding: 24, borderRadius: 16, border: '3px solid #fff', textAlign: 'center' }}>
            <h3>😎 Handsome Chicken: Top 3 Cards</h3>
            <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
              {peekCards.map((c, idx) => (
                <div key={c.id} style={{ background: '#fff', color: '#000', padding: 12, borderRadius: 10, width: 130 }}>
                  <strong>#{idx + 1}: {c.name}</strong>
                  <div style={{ margin: '6px 0' }}><ChickenArtwork card={c} /></div>
                  <p style={{ fontSize: 11 }}>{c.description}</p>
                </div>
              ))}
            </div>
            <button onClick={() => setPeekCards(null)} style={{ padding: '8px 16px', background: '#f59e0b', fontWeight: 'bold', borderRadius: 8 }}>Close</button>
          </div>
        </div>
      )}

      {/* Telescope Chicken Reorder Modal */}
      {reorderCards && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#1e293b', padding: 24, borderRadius: 16, border: '3px solid #fff', textAlign: 'center' }}>
            <h3>🔭 Telescope Chicken: Click cards to swap their order!</h3>
            <div style={{ display: 'flex', gap: 12, margin: '16px 0' }}>
              {reorderCards.map((c, idx) => (
                <div
                  key={c.id}
                  onClick={() => {
                    const next = [...reorderCards];
                    const swapIdx = (idx + 1) % next.length;
                    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
                    setReorderCards(next);
                  }}
                  style={{ background: '#ddd6fe', color: '#000', padding: 12, borderRadius: 10, width: 135, cursor: 'pointer', border: '2px solid #000' }}
                >
                  <strong>Draw #{idx + 1}: {c.name}</strong>
                  <div style={{ margin: '6px 0' }}><ChickenArtwork card={c} /></div>
                  <p style={{ fontSize: 10 }}>Click to move right ➡️</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                socket.emit('client:submit_reorder', { roomId: gameState.roomId, cardIds: reorderCards.map(c => c.id) });
                setReorderCards(null);
              }}
              style={{ padding: '8px 16px', background: '#22c55e', fontWeight: 'bold', borderRadius: 8, cursor: 'pointer' }}
            >
              Confirm New Order
            </button>
          </div>
        </div>
      )}

      {/* User's Note Rulebook Popup */}
      {showUsersNote && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
          <div style={{ background: '#fef9c3', color: '#000', padding: 24, borderRadius: 16, border: '4px solid #000', maxWidth: 540, width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <h2 style={{ marginTop: 0 }}>📜 Official Chicken User's Note</h2>
            {USERS_NOTE_RULES.map((item, idx) => (
              <div key={idx} style={{ marginBottom: 8, borderBottom: '1px dashed #a16207', paddingBottom: 6 }}>
                <strong>{item.name}:</strong> <span>{item.rule}</span>
              </div>
            ))}
            <button
              onClick={() => setShowUsersNote(false)}
              style={{ marginTop: 12, width: '100%', padding: 10, background: '#000', color: '#fff', fontWeight: 'bold', borderRadius: 8, cursor: 'pointer' }}
            >
              Got It! Back to Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
