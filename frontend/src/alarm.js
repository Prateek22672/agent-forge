// A loud, repeating alarm tone via the Web Audio API (no asset needed). Plays
// while the app/PWA is open; the push notification covers the closed case.
let ctx = null;
let timer = null;

export function startAlarm() {
  if (timer) return; // already ringing
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "square";
      // Two-tone warble so it reads as an alarm, not a notification blip.
      o.frequency.setValueAtTime(880, ctx.currentTime);
      o.frequency.setValueAtTime(660, ctx.currentTime + 0.25);
      g.gain.value = 0.18;
      o.start();
      o.stop(ctx.currentTime + 0.5);
    };
    beep();
    timer = setInterval(beep, 900);
  } catch {
    /* audio not available — the notification still shows */
  }
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  timer = null;
  if (ctx) {
    try {
      ctx.close();
    } catch {
      /* ignore */
    }
    ctx = null;
  }
}
