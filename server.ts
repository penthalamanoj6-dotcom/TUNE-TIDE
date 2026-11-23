import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { TRACK_CATALOG } from './catalog';
import { RoomState, QueuedTrack, RepeatMode } from './types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const DB_PATH = path.join(__dirname, '../room-state.json');

/**
 * Priority sorting algorithm:
 * Higher upvotes float to the top; ties are broken by earlier addedAt timestamp (FIFO decay).
 */
export function sortQueueByPriority(queue: QueuedTrack[]): QueuedTrack[] {
  return [...queue].sort((a, b) => {
    if (b.upvotes !== a.upvotes) {
      return b.upvotes - a.upvotes;
    }
    return a.addedAt - b.addedAt;
  });
}

function createInitialRoomState(): RoomState {
  const now = Date.now();
  const initialTrack: QueuedTrack = {
    ...TRACK_CATALOG[0], // Late Night Coding
    queueId: 'q-init-0',
    contributor: 'Alex (Host)',
    upvotes: 3,
    addedAt: now - 30000
  };

  const initialQueue: QueuedTrack[] = sortQueueByPriority([
    {
      ...TRACK_CATALOG[2], // Library Desk Lamp
      queueId: 'q-init-1',
      contributor: 'Priya',
      upvotes: 1,
      addedAt: now - 20000
    },
    {
      ...TRACK_CATALOG[3], // Algorithm Flow State
      queueId: 'q-init-2',
      contributor: 'Marcus',
      upvotes: 1,
      addedAt: now - 15000
    },
    {
      ...TRACK_CATALOG[5], // Espresso & Flashcards
      queueId: 'q-init-3',
      contributor: 'Maya',
      upvotes: 0,
      addedAt: now - 10000
    }
  ]);

  return {
    roomId: 'late-night-coding-jam',
    roomName: 'Late Night Coding Jam',
    activeListeners: 1,
    queue: initialQueue,
    playback: {
      currentTrack: initialTrack,
      isPlaying: false,
      elapsed: 0,
      shuffle: false,
      repeat: 'all',
      updatedAt: now
    },
    chat: [
      {
        id: 'msg-1',
        sender: 'Alex (Host)',
        text: 'Welcome to Late Night Coding Jam! Queue up study tracks and upvote your favorites.',
        timestamp: now - 60000
      },
      {
        id: 'msg-2',
        sender: 'Priya',
        text: 'Cranking through Data Structures lab—lo-fi + rain soundboard is elite.',
        timestamp: now - 25000
      }
    ]
  };
}

function loadState(): RoomState {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as RoomState;
      parsed.queue = sortQueueByPriority(parsed.queue || []);
      return parsed;
    }
  } catch (err) {
    console.warn('Could not read persisted room state, initializing fresh state.');
  }
  return createInitialRoomState();
}

let roomState: RoomState = loadState();
// Track votes server-side by userId -> Set<queueId> in addition to client LocalStorage
const serverVoteRegistry = new Map<string, Set<string>>();

function persistState(): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(roomState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist room state:', err);
  }
}

function broadcastRoomState(eventType = 'STATE_SYNC', extra: Record<string, unknown> = {}): void {
  roomState.activeListeners = Math.max(1, wss.clients.size);
  const payload = JSON.stringify({
    type: eventType,
    state: roomState,
    ...extra
  });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// --- REST API ENDPOINTS ---

app.get('/api/catalog', (_req: Request, res: Response) => {
  res.json({ tracks: TRACK_CATALOG, count: TRACK_CATALOG.length });
});

app.get('/api/room', (_req: Request, res: Response) => {
  res.json(roomState);
});

app.post('/api/queue', (req: Request, res: Response) => {
  const { trackId, contributor } = req.body as { trackId?: string; contributor?: string };
  const catalogTrack = TRACK_CATALOG.find((t) => t.id === trackId);
  if (!catalogTrack) {
    return res.status(404).json({ error: 'Track not found in catalog' });
  }

  const newEntry: QueuedTrack = {
    ...catalogTrack,
    queueId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    contributor: (contributor || 'Student').trim().slice(0, 24),
    upvotes: 0,
    addedAt: Date.now()
  };

  roomState.queue = sortQueueByPriority([...roomState.queue, newEntry]);
  if (!roomState.playback.currentTrack) {
    roomState.playback.currentTrack = roomState.queue.shift() || null;
    roomState.playback.elapsed = 0;
  }

  persistState();
  broadcastRoomState('QUEUE_UPDATED');
  return res.status(201).json({ entry: newEntry, queue: roomState.queue });
});

app.post('/api/queue/:queueId/upvote', (req: Request, res: Response) => {
  const { queueId } = req.params;
  const { userId, allowPeerSim } = req.body as { userId?: string; allowPeerSim?: boolean };

  const item = roomState.queue.find((q) => q.queueId === queueId);
  if (!item) {
    return res.status(404).json({ error: 'Queued track not found' });
  }

  if (!allowPeerSim && userId) {
    const voted = serverVoteRegistry.get(userId) || new Set<string>();
    if (voted.has(queueId)) {
      return res.status(409).json({ error: 'User already upvoted this track', queue: roomState.queue });
    }
    voted.add(queueId);
    serverVoteRegistry.set(userId, voted);
  }

  item.upvotes += 1;
  roomState.queue = sortQueueByPriority(roomState.queue);

  persistState();
  broadcastRoomState('QUEUE_UPDATED');
  return res.json({ item, queue: roomState.queue });
});

app.post('/api/playback', (req: Request, res: Response) => {
  const { action, elapsed, shuffle, repeat } = req.body as {
    action?: 'play' | 'pause' | 'seek' | 'next' | 'prev' | 'modes';
    elapsed?: number;
    shuffle?: boolean;
    repeat?: RepeatMode;
  };

  const now = Date.now();
  const pb = roomState.playback;

  if (action === 'play') {
    pb.isPlaying = true;
    pb.updatedAt = now;
  } else if (action === 'pause') {
    pb.isPlaying = false;
    if (typeof elapsed === 'number') pb.elapsed = elapsed;
    pb.updatedAt = now;
  } else if (action === 'seek' && typeof elapsed === 'number') {
    pb.elapsed = Math.max(0, elapsed);
    pb.updatedAt = now;
  } else if (action === 'modes') {
    if (typeof shuffle === 'boolean') pb.shuffle = shuffle;
    if (repeat) pb.repeat = repeat;
    pb.updatedAt = now;
  } else if (action === 'next') {
    if (pb.repeat === 'one' && pb.currentTrack) {
      pb.elapsed = 0;
    } else if (roomState.queue.length > 0) {
      const prevTrack = pb.currentTrack;
      let nextIdx = 0;
      if (pb.shuffle && roomState.queue.length > 1) {
        nextIdx = Math.floor(Math.random() * roomState.queue.length);
      }
      const [nextTrack] = roomState.queue.splice(nextIdx, 1);
      pb.currentTrack = nextTrack;
      pb.elapsed = 0;
      if (pb.repeat === 'all' && prevTrack) {
        roomState.queue = sortQueueByPriority([
          ...roomState.queue,
          { ...prevTrack, upvotes: 0, addedAt: now }
        ]);
      }
    } else if (pb.repeat === 'all' && pb.currentTrack) {
      pb.elapsed = 0;
    } else {
      pb.isPlaying = false;
      pb.elapsed = 0;
    }
    pb.updatedAt = now;
  } else if (action === 'prev') {
    pb.elapsed = 0;
    pb.updatedAt = now;
  }

  persistState();
  broadcastRoomState('PLAYBACK_UPDATED');
  res.json(pb);
});

app.post('/api/room/reset', (_req: Request, res: Response) => {
  serverVoteRegistry.clear();
  roomState = createInitialRoomState();
  persistState();
  broadcastRoomState('STATE_SYNC');
  res.json(roomState);
});

// --- WEBSOCKET REAL-TIME SYNC ---

wss.on('connection', (ws: WebSocket) => {
  broadcastRoomState('LISTENER_JOINED');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'CHAT_MESSAGE' && typeof msg.text === 'string' && msg.text.trim()) {
        const entry = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          sender: String(msg.sender || 'Student').slice(0, 24),
          text: msg.text.trim().slice(0, 240),
          timestamp: Date.now()
        };
        roomState.chat = [...roomState.chat.slice(-39), entry];
        persistState();
        broadcastRoomState('CHAT_UPDATED');
      } else if (msg.type === 'REACTION' && typeof msg.emoji === 'string') {
        broadcastRoomState('REACTION_BURST', {
          emoji: msg.emoji.slice(0, 4),
          sender: String(msg.sender || 'Student').slice(0, 24)
        });
      }
    } catch {
      // Ignore malformed WS packets
    }
  });

  ws.on('close', () => {
    broadcastRoomState('LISTENER_LEFT');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TuneTide: JamRoom Jam running at http://localhost:${PORT}`);
});
