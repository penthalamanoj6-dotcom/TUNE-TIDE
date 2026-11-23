export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // seconds
  genre: 'Lo-Fi' | 'Ambient' | 'Classical' | 'Binaural';
  bpm: number;
  baseFreq: number;
  chord: number[];
  coverGradient: [string, string];
  coverIcon: string;
  audioUrl?: string;
}

export interface QueuedTrack extends Track {
  queueId: string;
  contributor: string;
  upvotes: number;
  addedAt: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlaybackState {
  currentTrack: QueuedTrack | null;
  isPlaying: boolean;
  elapsed: number;
  shuffle: boolean;
  repeat: RepeatMode;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export interface RoomState {
  roomId: string;
  roomName: string;
  activeListeners: number;
  queue: QueuedTrack[];
  playback: PlaybackState;
  chat: ChatMessage[];
}
