/**
 * TuneTide: JamRoom Jam — Frontend Audio Engine, Democratic Queue & Sync Client
 */

class StudyAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.analyser = null;
    this.isUnlocked = false;
    this.isPlaying = false;
    this.currentTrack = null;
    this.stepTimer = null;
    this.stepIndex = 0;

    // Ambient focus soundboard nodes
    this.ambience = {
      rain: { active: false, gain: null, source: null, volume: 0.45 },
      cafe: { active: false, gain: null, source: null, volume: 0.35 },
      binaural: { active: false, gain: null, oscL: null, oscR: null, volume: 0.30 }
    };
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.75;

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.55;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 64;

      this.musicGain.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isUnlocked = true;
  }

  setMasterVolume(val) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(val, this.ctx.currentTime, 0.03);
    }
  }

  startTrack(track) {
    this.currentTrack = track;
    this.stopSequencer();
    if (!track || !this.isUnlocked) return;

    this.isPlaying = true;
    const stepMs = Math.round((60 / (track.bpm || 76)) * 1000);
    this.triggerStep();
    this.stepTimer = setInterval(() => {
      if (this.isPlaying) this.triggerStep();
    }, stepMs);
  }

  stopSequencer() {
    if (this.stepTimer) {
      clearInterval(this.stepTimer);
      this.stepTimer = null;
    }
  }

  setPlaying(playing, track) {
    this.isPlaying = playing;
    if (playing && track) {
      if (!this.stepTimer || this.currentTrack?.id !== track.id) {
        this.startTrack(track);
      }
    } else {
      this.stopSequencer();
    }
  }

  triggerStep() {
    if (!this.ctx || !this.currentTrack || !this.isPlaying) return;
    const now = this.ctx.currentTime;
    const chord = this.currentTrack.chord || [174.61, 220.0, 261.63, 329.63];
    const freq = chord[this.stepIndex % chord.length];

    // Warm electric-piano / felt pad tone
    const osc = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();
    const noteGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = this.currentTrack.genre === 'Classical' ? 'sine' : 'triangle';
    subOsc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    subOsc.frequency.setValueAtTime(freq * 0.5, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(920, now);

    noteGain.gain.setValueAtTime(0.001, now);
    noteGain.gain.exponentialRampToValueAtTime(0.16, now + 0.08);
    noteGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.35);

    osc.connect(filter);
    subOsc.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.musicGain);

    osc.start(now);
    subOsc.start(now);
    osc.stop(now + 1.4);
    subOsc.stop(now + 1.4);

    // Subtle lo-fi brush percussion on beats 1 and 3
    if (this.currentTrack.genre === 'Lo-Fi' && this.stepIndex % 2 === 1) {
      this.triggerSoftBrush(now);
    }

    this.stepIndex += 1;
  }

  triggerSoftBrush(now) {
    const bufferSize = this.ctx.sampleRate * 0.06;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.045;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);
    noise.start(now);
  }

  createNoiseBuffer(type) {
    const length = this.ctx.sampleRate * 3;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'rain') {
        // Pink-ish rain noise
        output[i] = (lastOut + 0.04 * white) / 1.04;
        lastOut = output[i];
        output[i] *= 2.8;
      } else {
        // Warm cafe murmur brownian noise
        output[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = output[i];
        output[i] *= 3.2;
      }
    }
    return buffer;
  }

  toggleAmbience(kind) {
    if (!this.isUnlocked) this.unlock();
    const slot = this.ambience[kind];
    if (!slot) return false;

    if (slot.active) {
      if (slot.source) {
        try { slot.source.stop(); } catch {}
        slot.source = null;
      }
      if (slot.oscL) {
        try { slot.oscL.stop(); slot.oscR.stop(); } catch {}
        slot.oscL = null;
        slot.oscR = null;
      }
      slot.active = false;
      return false;
    }

    const gain = this.ctx.createGain();
    gain.gain.value = slot.volume * 0.35;
    gain.connect(this.analyser);
    slot.gain = gain;

    if (kind === 'rain' || kind === 'cafe') {
      const src = this.ctx.createBufferSource();
      src.buffer = this.createNoiseBuffer(kind);
      src.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = kind === 'rain' ? 'bandpass' : 'lowpass';
      filter.frequency.value = kind === 'rain' ? 1100 : 480;

      src.connect(filter);
      filter.connect(gain);
      src.start();
      slot.source = src;
    } else if (kind === 'binaural') {
      // 200Hz left ear + 240Hz right ear = 40Hz Gamma focus binaural beat
      const merger = this.ctx.createChannelMerger(2);
      const oscL = this.ctx.createOscillator();
      const oscR = this.ctx.createOscillator();
      oscL.frequency.value = 200;
      oscR.frequency.value = 240;

      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(gain);

      oscL.start();
      oscR.start();
      slot.oscL = oscL;
      slot.oscR = oscR;
    }

    slot.active = true;
    return true;
  }

  setAmbienceVolume(kind, val) {
    const slot = this.ambience[kind];
    if (!slot) return;
    slot.volume = val;
    if (slot.gain && this.ctx) {
      slot.gain.gain.setTargetAtTime(val * 0.35, this.ctx.currentTime, 0.04);
    }
  }

  playBreakChime() {
    if (!this.isUnlocked) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.22);
      gain.gain.setValueAtTime(0.001, now + idx * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.18, now + idx * 0.22 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + idx * 0.22 + 1.5);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.22);
      osc.stop(now + idx * 0.22 + 1.6);
    });
  }

  getFrequencyData() {
    if (!this.analyser) return new Uint8Array(32).fill(8);
    const arr = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(arr);
    return arr;
  }
}

// --- APPLICATION STATE ---
const audioEngine = new StudyAudioEngine();
const USER_ID_KEY = 'tunetide_user_id';
const VOTED_IDS_KEY = 'tunetide_voted_queue_ids';

function getOrCreateUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = 'student-' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

function getLocalVotes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTED_IDS_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveLocalVote(queueId) {
  const votes = getLocalVotes();
  votes.add(queueId);
  localStorage.setItem(VOTED_IDS_KEY, JSON.stringify([...votes]));
}

const state = {
  userId: getOrCreateUserId(),
  username: 'Alex',
  catalog: [],
  room: null,
  ws: null,
  isDraggingSeek: false,
  localElapsed: 0,
  lastVolume: 0.75,
  pomo: {
    running: false,
    phase: 'FOCUS', // 'FOCUS' | 'BREAK'
    secondsLeft: 25 * 60,
    timerId: null
  }
};

// --- DOM ELEMENTS ---
const el = {
  entryOverlay: document.getElementById('entry-overlay'),
  usernameInput: document.getElementById('username-input'),
  joinRoomBtn: document.getElementById('join-room-btn'),
  roomNameDisplay: document.getElementById('room-name-display'),
  listenerCount: document.getElementById('listener-count'),
  resetDemoBtn: document.getElementById('reset-demo-btn'),

  albumArt: document.getElementById('album-art'),
  artworkInner: document.getElementById('artwork-inner'),
  artworkGlow: document.getElementById('artwork-glow'),
  artworkEmoji: document.getElementById('artwork-emoji'),
  artworkGenre: document.getElementById('artwork-genre'),
  currentContributor: document.getElementById('current-contributor'),
  trackTitle: document.getElementById('track-title'),
  trackArtist: document.getElementById('track-artist'),
  visualizerCanvas: document.getElementById('visualizer-canvas'),

  elapsedTime: document.getElementById('elapsed-time'),
  totalTime: document.getElementById('total-time'),
  seekSlider: document.getElementById('seek-slider'),
  scrubFill: document.getElementById('scrub-fill'),

  shuffleBtn: document.getElementById('shuffle-btn'),
  repeatBtn: document.getElementById('repeat-btn'),
  prevBtn: document.getElementById('prev-btn'),
  playPauseBtn: document.getElementById('play-pause-btn'),
  nextBtn: document.getElementById('next-btn'),
  muteBtn: document.getElementById('mute-btn'),
  volumeSlider: document.getElementById('volume-slider'),

  queueCount: document.getElementById('queue-count'),
  catalogCount: document.getElementById('catalog-count'),
  queueList: document.getElementById('queue-list'),
  catalogList: document.getElementById('catalog-list'),
  catalogSearch: document.getElementById('catalog-search'),
  genreFilter: document.getElementById('genre-filter'),
  openCatalogShortcut: document.getElementById('open-catalog-shortcut'),

  chatMessages: document.getElementById('chat-messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  reactionStage: document.getElementById('reaction-stage'),

  pomoWidget: document.getElementById('pomodoro-widget'),
  pomoPhase: document.getElementById('pomo-phase'),
  pomoClock: document.getElementById('pomo-clock'),
  pomoToggleBtn: document.getElementById('pomo-toggle-btn'),
  pomoDemoBtn: document.getElementById('pomo-demo-btn'),

  toast: document.getElementById('toast')
};

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove('show'), 2600);
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
}

// --- API & WEBSOCKET SYNC ---
async function fetchInitialData() {
  const [catRes, roomRes] = await Promise.all([
    fetch('/api/catalog'),
    fetch('/api/room')
  ]);
  const catData = await catRes.json();
  const roomData = await roomRes.json();
  state.catalog = catData.tracks || [];
  el.catalogCount.textContent = state.catalog.length;
  applyRoomState(roomData);
  renderCatalog();
}

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);
  state.ws = ws;

  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.state) {
      applyRoomState(payload.state);
    }
    if (payload.type === 'REACTION_BURST' && payload.emoji) {
      spawnFloatingEmoji(payload.emoji);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 2000);
  };
}

function applyRoomState(room) {
  state.room = room;
  el.roomNameDisplay.textContent = room.roomName;
  el.listenerCount.textContent = `${room.activeListeners} studying`;

  const pb = room.playback;
  const track = pb.currentTrack;

  if (track) {
    el.trackTitle.textContent = track.title;
    el.trackArtist.textContent = `${track.artist} • ${track.album}`;
    el.currentContributor.textContent = `Queued by ${track.contributor}`;
    el.artworkEmoji.textContent = track.coverIcon || '🎵';
    el.artworkGenre.textContent = (track.genre || 'STUDY').toUpperCase();
    const [c1, c2] = track.coverGradient || ['#6366f1', '#1e1b4b'];
    el.artworkInner.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    el.artworkGlow.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;

    el.seekSlider.max = track.duration;
    el.totalTime.textContent = formatTime(track.duration);

    if (!state.isDraggingSeek) {
      state.localElapsed = pb.elapsed;
      updateScrubberUI(state.localElapsed, track.duration);
    }
  }

  el.playPauseBtn.textContent = pb.isPlaying ? '⏸' : '▶';
  el.albumArt.classList.toggle('playing', pb.isPlaying);
  el.shuffleBtn.classList.toggle('active', pb.shuffle);

  el.repeatBtn.classList.toggle('active', pb.repeat !== 'off');
  el.repeatBtn.textContent = pb.repeat === 'one' ? '🔂' : '🔁';
  el.repeatBtn.title = `Repeat: ${pb.repeat.toUpperCase()}`;

  audioEngine.setPlaying(pb.isPlaying, track);
  renderQueue();
  renderChat();
}

function updateScrubberUI(elapsed, duration) {
  const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  el.seekSlider.value = elapsed;
  el.scrubFill.style.width = `${pct}%`;
  el.elapsedTime.textContent = formatTime(elapsed);
}

// --- RENDERING QUEUE, CATALOG & CHAT ---
function renderQueue() {
  if (!state.room) return;
  const queue = state.room.queue || [];
  const localVotes = getLocalVotes();
  el.queueCount.textContent = queue.length;

  if (queue.length === 0) {
    el.queueList.innerHTML = `<li class="track-item"><div class="track-details"><div class="track-details-title">Queue is empty</div><div class="track-details-sub">Add tracks from the Track Catalog tab!</div></div></li>`;
    return;
  }

  el.queueList.innerHTML = queue
    .map((item, idx) => {
      const rank = idx + 1;
      const hasVoted = localVotes.has(item.queueId);
      const [c1, c2] = item.coverGradient || ['#6366f1', '#1e1b4b'];
      return `
        <li class="track-item ${rank === 1 ? 'top-rank' : ''}">
          <div class="track-left">
            <span class="rank-badge">#${rank}</span>
            <div class="mini-art" style="background: linear-gradient(135deg, ${c1}, ${c2})">${item.coverIcon}</div>
            <div class="track-details">
              <div class="track-details-title">${escapeHtml(item.title)}</div>
              <div class="track-details-sub">${escapeHtml(item.artist)} • Added by ${escapeHtml(item.contributor)} • ${formatTime(item.duration)}</div>
            </div>
          </div>
          <div class="track-actions">
            <button
              class="upvote-btn ${hasVoted ? 'voted' : ''}"
              data-action="upvote"
              data-qid="${item.queueId}"
              title="${hasVoted ? 'You already upvoted this track' : 'Upvote track to move it up'}"
            >
              ▲ ${item.upvotes}
            </button>
            <button
              class="peer-sim-btn"
              data-action="peer-upvote"
              data-qid="${item.queueId}"
              title="Simulate a roommate/peer upvoting this track"
            >
              +Peer
            </button>
          </div>
        </li>
      `;
    })
    .join('');
}

function renderCatalog() {
  const query = el.catalogSearch.value.trim().toLowerCase();
  const genre = el.genreFilter.value;

  const filtered = state.catalog.filter((t) => {
    const matchesGenre = genre === 'ALL' || t.genre === genre;
    const matchesQuery =
      !query ||
      t.title.toLowerCase().includes(query) ||
      t.artist.toLowerCase().includes(query) ||
      t.album.toLowerCase().includes(query);
    return matchesGenre && matchesQuery;
  });

  el.catalogList.innerHTML = filtered
    .map((track) => {
      const [c1, c2] = track.coverGradient;
      return `
        <li class="track-item">
          <div class="track-left">
            <div class="mini-art" style="background: linear-gradient(135deg, ${c1}, ${c2})">${track.coverIcon}</div>
            <div class="track-details">
              <div class="track-details-title">${escapeHtml(track.title)}</div>
              <div class="track-details-sub">${escapeHtml(track.artist)} • ${track.genre} • ${formatTime(track.duration)}</div>
            </div>
          </div>
          <div class="track-actions">
            <button class="btn-chip" data-action="add-track" data-tid="${track.id}">+ Queue</button>
          </div>
        </li>
      `;
    })
    .join('');
}

function renderChat() {
  if (!state.room) return;
  const msgs = state.room.chat || [];
  el.chatMessages.innerHTML = msgs
    .map(
      (m) => `
      <div class="chat-msg">
        <div class="chat-msg-header">
          <span>${escapeHtml(m.sender)}</span>
          <span>${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="chat-msg-text">${escapeHtml(m.text)}</div>
      </div>
    `
    )
    .join('');
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spawnFloatingEmoji(emoji) {
  const node = document.createElement('div');
  node.className = 'floating-emoji';
  node.textContent = emoji;
  node.style.left = `${15 + Math.random() * 70}%`;
  el.reactionStage.appendChild(node);
  setTimeout(() => node.remove(), 2700);
}

// --- EVENT LISTENERS ---
el.joinRoomBtn.addEventListener('click', async () => {
  const name = el.usernameInput.value.trim();
  if (name) state.username = name;
  audioEngine.unlock();
  el.entryOverlay.classList.add('hidden');
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'play' })
  });
  showToast(`Joined Late Night Coding Jam as ${state.username}`);
});

el.playPauseBtn.addEventListener('click', async () => {
  audioEngine.unlock();
  const isPlaying = state.room?.playback?.isPlaying;
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: isPlaying ? 'pause' : 'play',
      elapsed: state.localElapsed
    })
  });
});

el.nextBtn.addEventListener('click', async () => {
  audioEngine.unlock();
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'next' })
  });
});

el.prevBtn.addEventListener('click', async () => {
  audioEngine.unlock();
  state.localElapsed = 0;
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prev' })
  });
});

el.shuffleBtn.addEventListener('click', async () => {
  const nextShuffle = !state.room?.playback?.shuffle;
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'modes', shuffle: nextShuffle })
  });
  showToast(`Shuffle ${nextShuffle ? 'Enabled' : 'Disabled'}`);
});

el.repeatBtn.addEventListener('click', async () => {
  const order = ['off', 'all', 'one'];
  const cur = state.room?.playback?.repeat || 'all';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'modes', repeat: next })
  });
  showToast(`Repeat Mode: ${next.toUpperCase()}`);
});

// Decoupled Scrubber Dragging (prevents audio stutter while dragging)
el.seekSlider.addEventListener('input', (e) => {
  state.isDraggingSeek = true;
  const val = parseFloat(e.target.value);
  const dur = state.room?.playback?.currentTrack?.duration || 185;
  updateScrubberUI(val, dur);
});

const commitSeek = async (e) => {
  if (!state.isDraggingSeek) return;
  state.isDraggingSeek = false;
  const val = parseFloat(e.target.value);
  state.localElapsed = val;
  await fetch('/api/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'seek', elapsed: val })
  });
};

el.seekSlider.addEventListener('change', commitSeek);
el.seekSlider.addEventListener('mouseup', commitSeek);
el.seekSlider.addEventListener('touchend', commitSeek);

// Volume & Mute
el.volumeSlider.addEventListener('input', (e) => {
  const v = parseFloat(e.target.value);
  state.lastVolume = v > 0 ? v : state.lastVolume;
  audioEngine.setMasterVolume(v);
  el.muteBtn.textContent = v === 0 ? '🔇' : '🔊';
});

el.muteBtn.addEventListener('click', () => {
  const current = parseFloat(el.volumeSlider.value);
  const next = current > 0 ? 0 : state.lastVolume || 0.75;
  el.volumeSlider.value = next;
  audioEngine.setMasterVolume(next);
  el.muteBtn.textContent = next === 0 ? '🔇' : '🔊';
});

// Study Mode Focus Soundboards
['rain', 'cafe', 'binaural'].forEach((kind) => {
  const toggleBtn = document.getElementById(`toggle-${kind}`);
  const volSlider = document.getElementById(`vol-${kind}`);
  const tile = document.querySelector(`.sound-tile[data-sound="${kind}"]`);

  toggleBtn.addEventListener('click', () => {
    const active = audioEngine.toggleAmbience(kind);
    toggleBtn.textContent = active ? 'ON' : 'OFF';
    tile.classList.toggle('active', active);
    showToast(`${kind.toUpperCase()} ambient layer ${active ? 'activated' : 'muted'}`);
  });

  volSlider.addEventListener('input', (e) => {
    audioEngine.setAmbienceVolume(kind, parseFloat(e.target.value));
  });
});

// Queue Upvoting & Peer Vote Simulation
el.queueList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const qid = btn.dataset.qid;
  const action = btn.dataset.action;

  if (action === 'upvote') {
    const localVotes = getLocalVotes();
    if (localVotes.has(qid)) {
      showToast('Vote limit: 1 upvote per track per student!');
      return;
    }
    const res = await fetch(`/api/queue/${qid}/upvote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.userId })
    });
    if (res.ok) {
      saveLocalVote(qid);
      showToast('Upvoted! Queue re-ordered by priority');
    }
  } else if (action === 'peer-upvote') {
    const res = await fetch(`/api/queue/${qid}/upvote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowPeerSim: true })
    });
    if (res.ok) {
      showToast('Simulated peer upvote! Watching queue leapfrog...');
    }
  }
});

// Catalog Filtering & Adding to Queue
el.catalogSearch.addEventListener('input', renderCatalog);
el.genreFilter.addEventListener('change', renderCatalog);

el.catalogList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="add-track"]');
  if (!btn) return;
  const trackId = btn.dataset.tid;
  const res = await fetch('/api/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId, contributor: state.username })
  });
  if (res.ok) {
    showToast('Added track to JamRoom queue!');
    switchTab('queue-view');
  }
});

// Tabs Navigation
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === tabId);
  });
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

el.openCatalogShortcut.addEventListener('click', () => switchTab('catalog-view'));

// Room Chat & Floating Emoji Reactions
el.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  state.ws.send(
    JSON.stringify({
      type: 'CHAT_MESSAGE',
      sender: state.username,
      text
    })
  );
  el.chatInput.value = '';
});

document.querySelectorAll('.react-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    spawnFloatingEmoji(emoji);
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: 'REACTION',
          sender: state.username,
          emoji
        })
      );
    }
  });
});

// Reset Demo State
el.resetDemoBtn.addEventListener('click', async () => {
  localStorage.removeItem(VOTED_IDS_KEY);
  await fetch('/api/room/reset', { method: 'POST' });
  showToast('Demo room reset to initial state!');
});

// Pomodoro Study-Break Audio Timer
function updatePomoUI() {
  el.pomoPhase.textContent = state.pomo.phase;
  el.pomoClock.textContent = formatTime(state.pomo.secondsLeft);
  el.pomoToggleBtn.textContent = state.pomo.running ? 'Pause' : 'Start';
  el.pomoWidget.classList.toggle('break-mode', state.pomo.phase === 'BREAK');
}

el.pomoToggleBtn.addEventListener('click', () => {
  state.pomo.running = !state.pomo.running;
  updatePomoUI();
});

el.pomoDemoBtn.addEventListener('click', () => {
  state.pomo.phase = 'FOCUS';
  state.pomo.secondsLeft = 5;
  state.pomo.running = true;
  updatePomoUI();
  showToast('Pomodoro fast-forwarded to 5s before study break!');
});

setInterval(async () => {
  if (!state.pomo.running) return;
  state.pomo.secondsLeft -= 1;
  if (state.pomo.secondsLeft <= 0) {
    if (state.pomo.phase === 'FOCUS') {
      state.pomo.phase = 'BREAK';
      state.pomo.secondsLeft = 5 * 60;
      audioEngine.playBreakChime();
      showToast('Pomodoro Focus Complete! Pausing music & playing break chimes.');
      if (state.room?.playback?.isPlaying) {
        await fetch('/api/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause', elapsed: state.localElapsed })
        });
      }
    } else {
      state.pomo.phase = 'FOCUS';
      state.pomo.secondsLeft = 25 * 60;
      showToast('Break over! Back to deep focus.');
    }
  }
  updatePomoUI();
}, 1000);

// Playback Clock Tick (250ms)
setInterval(async () => {
  const pb = state.room?.playback;
  const track = pb?.currentTrack;
  if (!pb || !track || !pb.isPlaying || state.isDraggingSeek) return;

  state.localElapsed += 0.25;
  if (state.localElapsed >= track.duration) {
    state.localElapsed = 0;
    await fetch('/api/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'next' })
    });
  } else {
    updateScrubberUI(state.localElapsed, track.duration);
  }
}, 250);

// Real-Time Canvas Frequency Bar Visualizer
function drawVisualizer() {
  const canvas = el.visualizerCanvas;
  const ctx = canvas.getContext('2d');
  const data = audioEngine.getFrequencyData();
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  const bars = 28;
  const gap = 4;
  const barWidth = (width - gap * (bars - 1)) / bars;

  for (let i = 0; i < bars; i++) {
    const val = data[i] || 6;
    const barHeight = Math.max(4, (val / 255) * (height - 6));
    const x = i * (barWidth + gap);
    const y = height - barHeight;

    const grad = ctx.createLinearGradient(0, y, 0, height);
    grad.addColorStop(0, '#22d3ee');
    grad.addColorStop(1, '#6366f1');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, 3);
    ctx.fill();
  }

  requestAnimationFrame(drawVisualizer);
}

// Boot
fetchInitialData().then(() => {
  connectWebSocket();
  updatePomoUI();
  drawVisualizer();
});
