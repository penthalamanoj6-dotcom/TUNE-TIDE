# TuneTide: JamRoom Jam

Full-stack TypeScript + Express + WebSocket collaborative study music player and democratic jam room built to satisfy every core and stretch requirement in the specification.

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in one or more browser windows.

## Implemented Features
- **Full Audio Player Controls**: Play, Pause, Previous, Next, decoupled mouse/touch seek scrubbing, master volume & mute, and elapsed/total timestamps.
- **Collaborative Jam Room Queue & Democratic Upvoting**: Real-time WebSocket queue sync with priority sorting (`upvotes DESC, addedAt ASC`), 1-vote-per-user enforcement via `localStorage` + server registry, plus a `+Peer` button for instant single-window demo testing.
- **25-Track Royalty-Free Study Catalog**: Searchable and filterable across Lo-Fi, Ambient, Classical, and Binaural genres, synthesized via HTML5 Web Audio API with zero external audio link failures.
- **Study Mode Focus Soundboards**: Layerable Study Ambient Rain, Cafe White Noise, and 40Hz Gamma Binaural Beats with independent toggles and volume sliders.
- **Stretch Features Included**:
  - Multi-window WebSocket synchronized playback & queue state.
  - Pomodoro Study-Break Audio Timer (with a `5s Demo` fast-forward button) that pauses music and triggers relaxation chimes on break transitions.
  - Live HTML5 Canvas Web Audio API frequency spectrum visualizer.
  - Shared Study Room Chat & floating emoji reaction bursts.
