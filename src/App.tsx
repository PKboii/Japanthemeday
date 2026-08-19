import { useEffect, useRef, useState } from "react";
import { Engine, CAPTIONS } from "./game/engine";
import { audio } from "./game/audio";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [caption, setCaption] = useState(-1);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new Engine(canvasRef.current, {
      onProgress: setProgress,
      onCaption: setCaption,
      onReady: () => setReady(true),
    });
    const wake = () => {
      setEntered(true);
      audio.init();
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("keydown", wake);
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      engine.dispose();
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("scroll", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  const showTitle = progress < 0.085;
  const showCue = progress < 0.02 && ready;
  const showEnd = progress > 0.965;
  const cap = caption >= 0 ? CAPTIONS[caption] : null;

  return (
    <div className="relative">
      {/* the scroll stage — 9 screens of director's timeline */}
      <div style={{ height: "900vh" }} aria-hidden />

      <canvas ref={canvasRef} className="fixed inset-0 h-full w-full" />

      {/* cinematic veil: vignette + film grain */}
      <div className="vignette pointer-events-none fixed inset-0" aria-hidden />
      <div className="grain pointer-events-none fixed inset-0" aria-hidden />

      {/* wordmark */}
      <header
        className="pointer-events-none fixed left-6 top-5 z-30 flex items-center gap-3 transition-opacity duration-700"
        style={{ opacity: ready ? 1 : 0 }}
      >
        <div className="flex h-9 w-9 items-center justify-center border border-[#f7f1e3]/40 bg-[#12161f]/35 text-[#f7f1e3] backdrop-blur-sm">
          <span className="font-display text-lg leading-none">森</span>
        </div>
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold tracking-[0.28em] text-[#f7f1e3] drop-shadow-[0_1px_6px_rgba(10,20,30,0.55)]">
            HINOMORI
          </div>
          <div className="text-[10px] tracking-[0.42em] text-[#f7f1e3]/70">日ノ森 · SPRING</div>
        </div>
      </header>

      {/* sound + replay */}
      <div
        className="fixed right-6 top-5 z-30 flex items-center gap-2 transition-opacity duration-700"
        style={{ opacity: ready ? 1 : 0 }}
      >
        <button
          onClick={() => { audio.init(); setMuted(audio.toggleMute()); }}
          className="flex h-9 w-9 items-center justify-center border border-[#f7f1e3]/40 bg-[#12161f]/35 text-[#f7f1e3] backdrop-blur-sm transition-colors hover:border-[#c2472f] hover:text-[#ffd9c8]"
          aria-label="Toggle sound"
          title="Sound"
        >
          {muted ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></svg>
          )}
        </button>
      </div>

      {/* progress hairline */}
      <div
        className="fixed right-[26px] top-1/2 z-20 hidden h-[46vh] w-px -translate-y-1/2 bg-[#f7f1e3]/25 md:block"
        style={{ opacity: ready && !showEnd ? 1 : 0, transition: "opacity .7s" }}
        aria-hidden
      >
        <div
          className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#c2472f]"
          style={{ top: `${progress * 100}%` }}
        />
        <div
          className="absolute right-3 -translate-y-1/2 font-display text-sm text-[#f7f1e3]/85"
          style={{ top: `${progress * 100}%`, textShadow: "0 1px 8px rgba(10,20,30,.6)" }}
        >
          {cap ? cap[2] : "道"}
        </div>
      </div>

      {/* hero title card */}
      <div
        className="pointer-events-none fixed inset-0 z-20 flex items-end justify-start transition-opacity duration-1000"
        style={{ opacity: showTitle && ready ? 1 : 0 }}
      >
        <div className="mb-[16vh] ml-6 md:ml-16">
          <div className="mb-3 text-[11px] font-medium tracking-[0.5em] text-[#f7f1e3]/75">
            ONE SPRING MORNING · TOLD IN A SINGLE SCROLL
          </div>
          <h1
            className="font-display text-[19vw] font-bold leading-[0.95] text-[#f7f1e3] md:text-[9.5rem]"
            style={{ textShadow: "0 2px 30px rgba(20,35,50,0.35), 0 1px 2px rgba(20,35,50,0.3)" }}
          >
            日ノ森
          </h1>
          <div className="mt-2 flex items-baseline gap-4">
            <span className="font-display text-2xl font-semibold tracking-[0.55em] text-[#f7f1e3] md:text-4xl" style={{ textShadow: "0 1px 12px rgba(20,35,50,.4)" }}>
              HINOMORI
            </span>
            <span className="hidden text-sm tracking-[0.2em] text-[#f7f1e3]/70 md:inline">a village below the mountains</span>
          </div>
        </div>
      </div>

      {/* scroll cue */}
      <div
        className="pointer-events-none fixed bottom-7 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-700"
        style={{ opacity: showCue ? 1 : 0 }}
      >
        <div className="text-[10px] tracking-[0.5em] text-[#f7f1e3]/80">SCROLL TO WALK</div>
        <div className="cue-line relative h-10 w-px overflow-hidden bg-[#f7f1e3]/25">
          <span className="cue-dot absolute left-1/2 h-3 w-px -translate-x-1/2 bg-[#c2472f]" />
        </div>
      </div>

      {/* scene caption */}
      <div className="pointer-events-none fixed bottom-8 left-6 z-20 md:left-14" aria-live="polite">
        {cap && !showEnd && (
          <div key={caption} className="caption-in flex items-center gap-4">
            <span
              className="font-display text-6xl font-semibold text-[#f7f1e3] md:text-7xl"
              style={{ textShadow: "0 2px 24px rgba(15,30,45,0.45)", writingMode: "vertical-rl" }}
            >
              {cap[2]}
            </span>
            <span className="max-w-[200px] text-[11px] font-medium uppercase tracking-[0.34em] text-[#f7f1e3]/85" style={{ textShadow: "0 1px 10px rgba(15,30,45,.5)" }}>
              {cap[3]}
            </span>
          </div>
        )}
      </div>

      {/* end card */}
      <div
        className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center transition-opacity duration-[1600ms]"
        style={{ opacity: showEnd ? 1 : 0 }}
      >
        <div className={`text-center ${showEnd ? "" : ""}`}>
          <div className="font-display text-xl tracking-[0.5em] text-[#f7f1e3]/80 md:text-2xl" style={{ textShadow: "0 2px 18px rgba(15,30,45,.5)" }}>
            日ノ森の静かな朝
          </div>
          <div
            className="font-display mt-3 text-4xl font-bold text-[#f7f1e3] md:text-6xl"
            style={{ textShadow: "0 2px 30px rgba(15,30,45,.5)" }}
          >
            A quiet morning in Hinomori.
          </div>
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="pointer-events-auto mt-9 border border-[#f7f1e3]/50 px-7 py-3 text-[11px] font-medium tracking-[0.4em] text-[#f7f1e3] transition-all duration-300 hover:border-[#c2472f] hover:bg-[#c2472f]/85 hover:text-white"
            style={{ opacity: showEnd ? 1 : 0 }}
          >
            WALK IT AGAIN
          </button>
          <div className="mt-4 text-[10px] tracking-[0.3em] text-[#f7f1e3]/55">or scroll up — the morning rewinds</div>
        </div>
      </div>

      {/* loading veil */}
      <div
        className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-[#0c1220] transition-opacity duration-[1200ms]"
        style={{ opacity: ready ? 0 : 1, pointerEvents: ready ? "none" : "auto" }}
      >
        <div className="font-display text-5xl text-[#f7f1e3]">日ノ森</div>
        <div className="h-px w-40 overflow-hidden bg-[#f7f1e3]/15">
          <div className={`h-full w-1/2 bg-[#c2472f] ${ready ? "" : "loading-slide"}`} />
        </div>
        <div className="text-[10px] tracking-[0.5em] text-[#f7f1e3]/60">ENTERING THE VALLEY</div>
      </div>

      {/* first-gesture hint for audio */}
      <div
        className="pointer-events-none fixed bottom-7 right-6 z-20 transition-opacity duration-700"
        style={{ opacity: ready && !entered ? 0.85 : 0 }}
      >
        <div className="text-[10px] tracking-[0.3em] text-[#f7f1e3]/70">CLICK / SCROLL ENABLES SOUND</div>
      </div>
    </div>
  );
}
