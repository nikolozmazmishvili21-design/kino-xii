import { test } from "node:test";
import assert from "node:assert/strict";
import { createHeroPlayback } from "../src/home/heroPlayback.js";

function fixture({ count = 4, ready = Array.from({ length: count }, (_, i) => i) } = {}) {
  let clock = 0, sequence = 0, state, progress;
  const frames = new Map();
  const playback = createHeroPlayback({ count, ready, now: () => clock,
    requestFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelFrame: id => frames.delete(id), onChange: next => { state = next; }, onProgress: next => { progress = next; },
  });
  playback.start();
  return { playback, frames, state: () => state, progress: () => progress,
    tick(ms) { clock += ms; const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(clock)); },
  };
}

test("one clock advances all featured titles, crossfades and wraps with synchronized progress", () => {
  const h = fixture();
  for (let index = 0; index < 4; index++) {
    assert.equal(h.state().index, index); assert.equal(h.frames.size, 1);
    h.tick(1500); assert.equal(h.progress(), 0.5);
    h.tick(1500); assert.equal(h.state().index, (index + 1) % 4);
    assert.equal(h.state().previous, index); assert.equal(h.state().phase, "fading");
    h.tick(300); assert.equal(h.state().phase, "holding"); assert.equal(h.state().previous, null);
    assert.equal(h.progress(), 0); assert.equal(h.frames.size, 1);
  }
  h.playback.destroy(); assert.equal(h.frames.size, 0);
});

test("manual wrapping resets the dwell and rapid clicks cannot create overlapping transitions", () => {
  const h = fixture(); h.tick(2200); h.playback.move(-1);
  assert.equal(h.state().index, 3); assert.equal(h.progress(), 0);
  h.playback.move(1); h.playback.move(-1); assert.equal(h.state().index, 3); assert.equal(h.frames.size, 1);
  h.tick(300); h.playback.move(-1); assert.equal(h.state().index, 2); assert.equal(h.state().duration, 700);
  h.tick(699); assert.equal(h.state().phase, "fading"); h.tick(1); assert.equal(h.state().phase, "holding");
  h.tick(2999); assert.equal(h.state().index, 2); h.tick(1); assert.equal(h.state().index, 3);
  h.tick(300); h.playback.move(1); assert.equal(h.state().index, 0);
});

test("hidden/offscreen time does not accumulate and independent pause reasons must all clear", () => {
  const h = fixture(); h.tick(1000);
  h.playback.pause("hidden", true); h.playback.pause("offscreen", true); assert.equal(h.frames.size, 0);
  h.tick(60000); h.playback.pause("hidden", false); assert.equal(h.frames.size, 0);
  h.playback.pause("offscreen", false); assert.equal(h.frames.size, 1);
  h.tick(1999); assert.equal(h.state().index, 0); h.tick(1); assert.equal(h.state().index, 1);
});

test("keyboard/pointer pauses allow an explicit fade to finish, then retain the selected slide", () => {
  const h = fixture(); h.playback.pause("focus", true); h.playback.pause("pointer", true);
  assert.equal(h.frames.size, 0); h.playback.move(1); assert.equal(h.frames.size, 1);
  h.tick(300); assert.equal(h.frames.size, 0); h.tick(30000); assert.equal(h.state().index, 1);
  h.playback.pause("pointer", false); assert.equal(h.frames.size, 0);
  h.playback.pause("focus", false); assert.equal(h.frames.size, 1);
});

test("reduced motion stops autoplay and makes explicit navigation immediate", () => {
  const h = fixture(); h.playback.reduceMotion(true); assert.equal(h.frames.size, 0);
  h.playback.move(-1); assert.equal(h.state().index, 3); assert.equal(h.state().phase, "holding");
  assert.equal(h.state().duration, 0); assert.equal(h.state().previous, null); assert.equal(h.frames.size, 0);
  h.playback.reduceMotion(false); h.tick(3000); assert.equal(h.state().index, 0);
  h.playback.reduceMotion(true); assert.equal(h.state().phase, "holding"); assert.equal(h.frames.size, 0);
});

test("zero/single featured movies schedule no timers or transitions", () => {
  for (const count of [0, 1]) {
    const h = fixture({ count }); h.playback.move(1); h.tick(60000);
    assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  }
});

test("initial and incoming backdrops decode before starting their dwell/fade", () => {
  const h = fixture({ ready: [] }); assert.equal(h.frames.size, 0);
  h.playback.ready(0); h.tick(3000); assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  h.playback.move(1); assert.equal(h.state().index, 0);
  h.playback.ready(1); assert.equal(h.state().index, 1); assert.equal(h.state().phase, "fading");
});

test("a delayed autoplay image cannot replace a slide while the user has keyboard focus", () => {
  const h = fixture({ ready: [0] }); h.tick(3000); h.playback.pause("focus", true);
  h.playback.ready(1); assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  h.playback.pause("focus", false); assert.equal(h.state().index, 1); assert.equal(h.state().phase, "fading");
});

test("destroy cancels scheduled work and ignores late image callbacks; remount owns one clock", () => {
  const h = fixture({ ready: [0] }); h.tick(3000); h.playback.destroy();
  h.playback.ready(1); h.playback.start(); h.playback.move(1); h.playback.pause("focus", false);
  assert.equal(h.frames.size, 0); assert.equal(h.state().index, 0);
  const remount = fixture(); assert.equal(remount.frames.size, 1);
});

test("manual navigation overrides a pending automatic decode without adopting its late completion", () => {
  const h = fixture({ ready: [0, 3] }); h.tick(3000);
  assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  h.playback.move(-1); assert.equal(h.state().index, 3); assert.equal(h.progress(), 0);
  h.playback.ready(1); assert.equal(h.state().index, 3); assert.equal(h.frames.size, 1);
  h.tick(300); h.tick(2999); assert.equal(h.state().index, 3);
  h.tick(1); assert.equal(h.state().index, 0);
  h.tick(300); h.tick(3000); assert.equal(h.state().index, 1);
});

test("latest manual decode target wins when pending images become ready out of order", () => {
  const h = fixture({ ready: [0] }); h.tick(3000);
  h.playback.move(-1); h.playback.ready(1);
  assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  h.playback.move(1); assert.equal(h.state().index, 1);
  h.playback.ready(3); assert.equal(h.state().index, 1); assert.equal(h.frames.size, 1);
  h.tick(300); assert.equal(h.state().phase, "holding");
});

test("manual intent toward an automatic pending target can complete during keyboard pause", () => {
  const h = fixture({ ready: [0] }); h.tick(3000); h.playback.pause("focus", true);
  h.playback.move(1); h.playback.ready(1); assert.equal(h.state().index, 1);
  h.tick(300); assert.equal(h.frames.size, 0); h.tick(9000); assert.equal(h.state().index, 1);
  h.playback.pause("focus", false); assert.equal(h.frames.size, 1);
});

test("superseding a manual pending target retains the current image until the latest decode", () => {
  const h = fixture({ ready: [0] }); h.playback.move(1); h.playback.move(-1);
  h.playback.ready(1); assert.equal(h.state().index, 0); assert.equal(h.frames.size, 0);
  h.playback.ready(3); assert.equal(h.state().index, 3); assert.equal(h.state().previous, 0);
  h.playback.move(1); assert.equal(h.state().index, 3); assert.equal(h.frames.size, 1);
});
