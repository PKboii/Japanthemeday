import { useEffect, useRef, useState } from "react";
import { createGame, GameAPI, UIState } from "./game/engine";
import { MEMORIES, SEASON_JP, SEASON_EN, Season, Weather } from "./game/state";

interface Toast { id: number; text: string; kind: "info" | "memory" | "quest" }

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
const WEATHERS: { id: Weather; jp: string; en: string }[] = [
  { id: "clear", jp: "晴", en: "Clear" },
  { id: "rain", jp: "雨", en: "Rain" },
  { id: "snow", jp: "雪", en: "Snow" },
];

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GameAPI | null>(null);
  const [ui, setUi] = useState<UIState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState(0);
  const [entered, setEntered] = useState(false);
  const toastId = useRef(0);

  useEffect(() => {
    if (!mountRef.current) return;
    const { api, dispose } = createGame(mountRef.current, {
      onUI: (s) => setUi(s),
      onToast: (text, kind = "info") => {
        const id = ++toastId.current;
        setToasts((t) => [...t.slice(-3), { id, text, kind }]);
        window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600);
      },
      onPhoto: () => setFlash((f) => f + 1),
      onMemory: () => {},
    });
    apiRef.current = api;
    const enter = () => { setEntered(true); api.begin(); };
    window.addEventListener("pointerdown", enter, { once: true });
    window.addEventListener("keydown", enter, { once: true });
    window.addEventListener("wheel", () => setEntered(true), { once: true, passive: true });
    return () => {
      dispose();
      window.removeEventListener("pointerdown", enter);
      window.removeEventListener("keydown", enter);
    };
  }, []);

  const progress = apiRef.current?.state.progress ?? 0;

  return (
    <div className="font-body text-[#f4eee0]">
      {/* the persistent 3D world */}
      <div ref={mountRef} className="fixed inset-0 z-0" />
      {/* scroll stage — scroll is the day's timeline */}
      <div style={{ height: "820vh" }} aria-hidden />

      {/* photo shutter flash */}
      {flash > 0 && (
        <div key={flash} className="pointer-events-none fixed inset-0 z-50 bg-white anim-shutter" />
      )}

      {/* ============ TOP LEFT — identity + clock ============ */}
      <div className="pointer-events-none fixed left-5 top-5 z-30 flex items-start gap-3">
        <div className="ink-chip rounded-md px-2.5 py-3 flex flex-col items-center gap-2">
          <span className="v-text font-display text-lg font-bold text-[#f4eee0] leading-none">日ノ森</span>
          <span className="seal rounded-sm px-1.5 py-1 font-display text-[10px] leading-none">村</span>
        </div>
        <div className="mt-1">
          <div className="font-display text-[13px] tracking-[0.42em] text-[#f4eee0]/90 uppercase">Hinomori</div>
          <div className="mt-2 ink-chip inline-flex items-center gap-2.5 rounded-md px-3 py-2">
            <span className="font-display text-xl font-bold tabular-nums leading-none">{ui?.time ?? "05:30"}</span>
            <span className="h-4 w-px bg-[#7a90af]/40" />
            <span className="text-[11px] tracking-widest text-[#c6d2e4]">{ui?.phase ?? "Dawn"}</span>
          </div>
          {ui?.carrying && (
            <div className="anim-fade-up mt-2 ink-chip inline-flex items-center gap-2 rounded-md px-3 py-1.5">
              <span className="seal h-2 w-2 rounded-full" />
              <span className="text-[11px] tracking-wide text-[#e8dcc8]">Carrying · {ui.carrying}</span>
            </div>
          )}
          {ui?.questHint && (
            <div className="anim-fade-up mt-2 max-w-[240px] ink-chip rounded-md px-3 py-2">
              <div className="text-[9px] tracking-[0.28em] text-[#d9a441] font-bold">VILLAGE WHISPERS</div>
              <div className="mt-1 text-[11px] leading-snug text-[#dce4f0]/90">{ui.questHint}</div>
            </div>
          )}
        </div>
      </div>

      {/* ============ TOP RIGHT — season / weather / sound ============ */}
      <div className="fixed right-5 top-5 z-30 flex flex-col items-end gap-2">
        <div className="ink-chip flex items-center gap-1 rounded-md p-1.5">
          {SEASONS.map((s) => (
            <button
              key={s}
              onClick={() => apiRef.current?.setSeason(s)}
              className={`group rounded px-2.5 py-1.5 text-center transition-all duration-200 ${
                ui?.season === s ? "seal" : "hover:bg-[#2c3c55]/70"
              }`}
              title={SEASON_EN[s]}
            >
              <span className="font-display text-base leading-none">{SEASON_JP[s]}</span>
              <span className={`block text-[8px] tracking-[0.2em] ${ui?.season === s ? "text-[#fdf6e8]/90" : "text-[#93a5c0]"}`}>
                {SEASON_EN[s].toUpperCase()}
              </span>
            </button>
          ))}
          <span className="mx-1 h-7 w-px bg-[#7a90af]/30" />
          {WEATHERS.map((w) => (
            <button
              key={w.id}
              onClick={() => apiRef.current?.setWeather(w.id)}
              className={`rounded px-2 py-1.5 font-display text-base leading-none transition-all ${
                ui?.weather === w.id ? "seal" : "text-[#c6d2e4] hover:bg-[#2c3c55]/70"
              }`}
              title={w.en}
            >
              {w.jp}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => apiRef.current?.toggleJournal()}
            className="ink-chip rounded-md px-3 py-1.5 text-[11px] tracking-widest text-[#c6d2e4] hover:text-white transition-colors"
          >
            JOURNAL · {ui?.memories ?? 0}/{ui?.totalMemories ?? MEMORIES.length}
          </button>
          <button
            onClick={() => apiRef.current?.toggleAudio()}
            className="ink-chip flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] tracking-widest text-[#c6d2e4] hover:text-white transition-colors"
            title="Toggle sound"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              {ui?.audioOn === false ? (
                <><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></>
              ) : (
                <><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" /></>
              )}
            </svg>
            SOUND
          </button>
          <button
            onClick={() => apiRef.current?.photo()}
            className="ink-chip flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] tracking-widest text-[#c6d2e4] hover:text-white transition-colors"
            title="Photograph (P)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            PHOTO
          </button>
        </div>
      </div>

      {/* ============ RIGHT — day rail ============ */}
      <div className="pointer-events-none fixed right-[26px] top-1/2 z-20 -translate-y-1/2 hidden md:flex flex-col items-center gap-2">
        <span className="text-[10px] text-[#c6d2e4]/70 font-display">日</span>
        <div className="relative h-44 w-[3px] rounded bg-[#2c3c55]/80">
          <div
            className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_0_10px_rgba(255,217,160,0.8)]"
            style={{
              top: `${(progress ?? 0) * 100}%`,
              background: (ui?.phase === "Night" || ui?.phase === "Evening") ? "#c8d4ec" : "#ffd9a0",
            }}
          />
        </div>
        <span className="text-[10px] text-[#c6d2e4]/70 font-display">夜</span>
      </div>

      {/* ============ CAPTION (scrollytelling) ============ */}
      {ui?.caption && ui.caption.o > 0.02 && (
        <div
          className="pointer-events-none fixed inset-x-0 top-[16vh] z-20 flex flex-col items-center text-center px-6"
          style={{ opacity: ui.caption.o }}
        >
          <div className="font-display text-3xl md:text-5xl font-bold tracking-[0.18em] text-[#fdf8ec] drop-shadow-[0_4px_18px_rgba(10,16,28,0.65)]">
            {ui.caption.title}
          </div>
          <div className="mt-3 text-[11px] md:text-xs tracking-[0.3em] text-[#e8dcc8]/90 uppercase drop-shadow-[0_2px_8px_rgba(10,16,28,0.8)]">
            {ui.caption.sub}
          </div>
          <div className="mt-4 h-px w-16 bg-[#d84f35]/80" />
        </div>
      )}

      {/* ============ toasts ============ */}
      <div className="pointer-events-none fixed right-5 top-[120px] z-40 flex w-[300px] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="anim-toast ink-chip rounded-md border-l-2 px-3.5 py-2.5"
            style={{ borderLeftColor: t.kind === "memory" ? "#d9a441" : t.kind === "quest" ? "#d84f35" : "#86a868" }}>
            <div className="text-[9px] tracking-[0.28em] font-bold"
              style={{ color: t.kind === "memory" ? "#d9a441" : t.kind === "quest" ? "#e05a3e" : "#86a868" }}>
              {t.kind === "memory" ? "MEMORY KEPT" : t.kind === "quest" ? "A KINDNESS" : "HINOMORI"}
            </div>
            <div className="mt-0.5 text-[12px] leading-snug text-[#e8eef8]">{t.text}</div>
          </div>
        ))}
      </div>

      {/* ============ interaction prompt ============ */}
      {ui?.prompt && !ui.dialogue && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[120px] z-30 flex justify-center">
          <div className="anim-fade-up ink-chip flex items-center gap-2.5 rounded-full px-4 py-2">
            <span className="prompt-dot h-2 w-2 rounded-full bg-[#d84f35]" />
            <span className="text-[12px] tracking-wide text-[#eef2fa]">{ui.prompt}</span>
            <span className="kbd ml-1">E</span>
          </div>
        </div>
      )}

      {/* ============ dialogue ============ */}
      {ui?.dialogue && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <button
            onClick={() => apiRef.current?.interact()}
            className="paper-card anim-fade-up w-full max-w-xl rounded-md px-6 py-5 text-left transition-transform hover:scale-[1.01] active:scale-[0.995]"
          >
            <div className="flex items-baseline justify-between">
              <div className="flex items-baseline gap-3">
                <span className="seal rounded-sm px-2 py-0.5 font-display text-sm font-bold">
                  {ui.dialogue.name}
                </span>
                <span className="text-[10px] tracking-[0.22em] text-[#7a6a50] uppercase">{ui.dialogue.role}</span>
              </div>
              <span className="text-[10px] tracking-widest text-[#a08c66]">
                {ui.dialogue.last ? "E ▸ close" : "E ▸ next"}
              </span>
            </div>
            <p className="font-display mt-3 text-lg leading-relaxed text-[#2c2418]">
              {ui.dialogue.text}
            </p>
          </button>
        </div>
      )}

      {/* ============ intro / controls ============ */}
      {ui?.intro && (
        <div className="pointer-events-none fixed inset-x-0 bottom-8 z-30 flex justify-center px-4">
          <div className="anim-fade-up ink-chip rounded-md px-5 py-3.5 text-center" style={{ animationDelay: "0.6s" }}>
            <div className="font-display text-sm tracking-[0.3em] text-[#fdf6e8]">A DAY IN HINOMORI</div>
            <div className="mt-1.5 text-[11px] text-[#c6d2e4]">
              Scroll to walk the hill path & move the hours · <span className="kbd">W A S D</span> to roam free anytime
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed bottom-5 left-5 z-20 hidden lg:block">
        <div className="ink-chip rounded-md px-3.5 py-3 text-[10px] leading-[1.9] text-[#9fb0c9]">
          <div className="mb-1 text-[9px] tracking-[0.3em] text-[#c6d2e4]/80 font-bold">HOW TO WANDER</div>
          <div><span className="kbd">W A S D</span> walk · <span className="kbd">SHIFT</span> run · drag to look</div>
          <div><span className="kbd">E</span> interact · <span className="kbd">P</span> photograph · <span className="kbd">J</span> journal</div>
          <div className="text-[#7d8ea8]">click the ground to stroll · scroll turns the day</div>
        </div>
      </div>

      {/* ============ journal drawer ============ */}
      {ui?.journalOpen && (
        <div className="fixed right-0 top-0 z-50 h-full w-[330px] max-w-[88vw]">
          <div className="paper-card journal-scroll h-full overflow-y-auto rounded-none border-l px-6 py-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-2xl font-bold text-[#2c2418]">旅の記録</div>
                <div className="text-[9px] tracking-[0.3em] text-[#7a6a50] uppercase mt-1">Field Journal</div>
              </div>
              <button onClick={() => apiRef.current?.toggleJournal()} className="rounded px-2 py-1 text-[#7a6a50] hover:bg-[#e0d5bc] text-lg leading-none">×</button>
            </div>

            <div className="mt-5 rounded border border-[#c9b98f] bg-[#efe6d1] px-3 py-2.5 flex items-center justify-between">
              <span className="text-[10px] tracking-[0.22em] text-[#7a6a50] font-bold">VILLAGE TRUST</span>
              <span className="flex items-center gap-1.5">
                {Array.from({ length: Math.min(ui.rep, 8) }).map((_, i) => (
                  <span key={i} className="seal h-2.5 w-2.5 rounded-full" />
                ))}
                {ui.rep === 0 && <span className="text-[11px] text-[#a08c66]">a stranger, warmly watched</span>}
              </span>
            </div>

            <div className="mt-5 text-[10px] tracking-[0.3em] text-[#7a6a50] font-bold">
              MEMORIES · {ui.memories}/{ui.totalMemories}
            </div>
            <div className="mt-3 space-y-2.5">
              {MEMORIES.map((m) => {
                const got = apiRef.current?.state.memories.includes(m.id);
                return (
                  <div key={m.id} className={`rounded border px-3 py-2.5 flex items-center gap-3 transition-all ${
                    got ? "border-[#c9a05a] bg-[#f3e8cf]" : "border-[#ddd2b8] bg-[#ece4d0] opacity-70"
                  }`}>
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-sm font-display text-xl font-bold ${
                      got ? "seal" : "bg-[#d8cdb2] text-[#a99a78]"
                    }`}>
                      {got ? m.kanji : "？"}
                    </div>
                    <div className="min-w-0">
                      <div className="font-display text-[13px] font-bold text-[#2c2418] leading-tight">
                        {got ? m.title : "Somewhere, someday"}
                      </div>
                      <div className="mt-0.5 text-[10.5px] leading-snug text-[#6a5b42]">
                        {got ? m.note : "Keep exploring — press P where the view pulls at you."}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 text-[10px] tracking-[0.3em] text-[#7a6a50] font-bold">KINDNESSES</div>
            <div className="mt-2 space-y-1.5 text-[11.5px] text-[#4a3f2c]">
              <div className={apiRef.current?.state.questBread === 2 ? "" : "opacity-45"}>
                ◈ Warm anpan, delivered to the terraces
              </div>
              <div className={apiRef.current?.state.questUmbrella === 2 ? "" : "opacity-45"}>
                ◈ Aiko's umbrella, home from the river
              </div>
            </div>
          </div>
        </div>
      )}

      {/* enter hint */}
      {!entered && (
        <div className="pointer-events-none fixed inset-x-0 top-[30vh] z-30 flex justify-center">
          <div className="anim-breathe ink-chip rounded-full px-5 py-2.5 text-[11px] tracking-[0.28em] text-[#e8dcc8]">
            SCROLL, CLICK, OR PRESS ANY KEY TO STEP INTO THE VALLEY
          </div>
        </div>
      )}
    </div>
  );
}
