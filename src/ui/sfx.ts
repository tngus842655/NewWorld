/**
 * 효과음 — Web Audio 지연 로드·캐시. 항상 non-critical: 실패는 조용히 무시한다 (GDD §11.1).
 * settings 연동은 부팅 시 setSfxEnabled 주입으로 받는다 (state 의존 없음 — kit↔store 순환 방지).
 * 파일 대장: docs/ASSETS.md §4-1 — 코드는 id만 알고, 교체는 파일 갈아끼우기로 끝난다.
 */
export type SfxId =
  | 'tap' | 'open' | 'close' | 'confirm' | 'error' | 'question' | 'select' | 'treasure'
  | 'defeat' | 'trap' | 'artifact' | 'gather' | 'enhance' | 'salvage' | 'craft'
  | 'capture-new' | 'capture-dupe' | 'capture-miss' | 'levelup' | 'awaken' | 'revive'
  | 'wipe' | 'milestone';

export const ALL_SFX: SfxId[] = [
  'tap', 'open', 'close', 'confirm', 'error', 'question', 'select', 'treasure',
  'defeat', 'trap', 'artifact', 'gather', 'enhance', 'salvage', 'craft',
  'capture-new', 'capture-dupe', 'capture-miss', 'levelup', 'awaken', 'revive',
  'wipe', 'milestone',
];

// UI 조작음은 낮게, 축하음은 높게 (미지정 0.45)
const VOLUME: Partial<Record<SfxId, number>> = {
  tap: 0.22, open: 0.3, close: 0.3, select: 0.4,
  'capture-new': 0.6, awaken: 0.6, milestone: 0.6,
};

let enabled = true;
let ctx: AudioContext | null = null;
const buffers = new Map<SfxId, Promise<AudioBuffer | null>>();

export function setSfxEnabled(value: boolean): void {
  enabled = value;
}

/** 모바일 자동재생 정책: 사용자 제스처 컨텍스트에서 처음 호출되어야 running이 된다 */
function audioCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function loadBuffer(context: AudioContext, id: SfxId): Promise<AudioBuffer | null> {
  const cached = buffers.get(id);
  if (cached) return cached;
  const loading = fetch(`/assets/sfx/${id}.ogg`)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    .then((data) => context.decodeAudioData(data))
    .catch(() => null);
  buffers.set(id, loading);
  return loading;
}

/** 재생 — fire & forget. 꺼져 있거나 로드 실패면 아무 일도 일어나지 않는다. */
export function playSfx(id: SfxId): void {
  if (!enabled) return;
  const context = audioCtx();
  if (!context) return;
  void loadBuffer(context, id).then((buffer) => {
    if (!buffer || !enabled || context.state !== 'running') return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = VOLUME[id] ?? 0.45;
    source.connect(gain);
    gain.connect(context.destination);
    source.start();
  });
}

/** 첫 사용자 제스처에서 전량 프리로드 (~230KB) — 첫 재생 씹힘 방지 */
export function preloadAllSfx(): void {
  const context = audioCtx();
  if (!context) return;
  for (const id of ALL_SFX) void loadBuffer(context, id);
}
