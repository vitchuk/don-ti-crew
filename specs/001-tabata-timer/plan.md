# План реализации: Tabata-таймер (шаблон тренировки, сессия, PWA)

Спека: [spec.md](spec.md). Задачи: [tasks.md](tasks.md).

## Подход

Единый пакет `apps/client` (pnpm workspace, TypeScript — ADR-0001): Vue 3 + Vite + `vite-plugin-pwa` (ADR-0002), данные локально/офлайн (Dexie, ADR-0003). Внешние зависимости только оправданные: `vue`, `vite`, `typescript`, `vite-plugin-pwa`, `dexie`; dev-тесты — `vitest`, `@vue/test-utils`, `fake-indexeddb`. Без UI-библиотек — собственный CSS.

**Состояние — composables (не Pinia).** Обоснование: у клиента ровно две локальные области состояния — активная сессия и данные Dexie (шаблоны, история). Обе обслуживаются простыми composables (`useTimerSession`, `useTemplates`, `useHistory`), а Pinia добавила бы слой абстракции и зависимость без пользы при отсутствии глобального Redux-подобного графа. Если позже появятся более сложные контексты (напр., синхронизация), решение можно пересмотреть отдельным ADR.

Ключевая идея таймера: движок хранит не «прошедшее время», а **целевые моменты (`endsAt`) в абсолютных метках** (`performance.now()`), пересчитываемые при паузах; тик-интервал нужен только для перерисовки и запуска бипов, поэтому дрейф от «накопления setInterval» исключён.

## Компоненты и файлы

```
apps/client/
├─ index.html                     (viewport-fit=cover, тема)
├─ vite.config.ts                 (base-path, vite-plugin-pwa)
├─ public/icons/                  (иконки PWA, maskable)
├─ src/
│  ├─ main.ts
│  ├─ App.vue                     (каркас: экраны навигации)
│  ├─ styles/base.css             (тёмная тема, крупная типографика, safe-area)
│  ├─ domain/
│  │  ├─ protocol.ts              (TabataProtocol, валидация, значения по умолчанию)
│  │  ├─ phaseMachine.ts          (чистый TimerEngine: FSM фаз)
│  │  └─ beepPlan.ts              (чистые сигналы: какие бипы когда)
│  ├─ audio/audioCues.ts          (Web Audio API: осциллятор-бипы)
│  ├─ db/db.ts                    (Dexie: WorkoutTemplate, TrainingSession)
│  ├─ db/repositories.ts          (templatesRepo, sessionsRepo)
│  ├─ composables/
│  │  ├─ useTimerSession.ts       (склейка FSM + audio + сохранение сессии)
│  │  ├─ useTemplates.ts
│  │  └─ useHistory.ts
│  ├─ components/                 (TimerScreen, SetupScreen, TemplateListScreen,
│  │                               HistoryScreen, PhaseBadge, BeepRing/прогресс)
│  └─ presets/presets.ts          (два пресета, isPreset=true)
└─ tests/                         (vitest unit + e2e-сценарии FSM)
```

## Контракты

```ts
// domain/protocol.ts
export interface TabataProtocol {
  prepareSec: number;            // default 10
  workSec: number;               // default 20
  restSec: number;               // default 10
  rounds: number;                // default 8, 1..30
  cycles: number;                // default 1, 1..10
  restBetweenCyclesSec: number;  // default 60, используется только при cycles > 1
}
export const DEFAULT_PROTOCOL: TabataProtocol;
export function validateProtocol(p: TabataProtocol): ValidationError[]; // пустой массив = валидно
export interface ValidationError { field: keyof TabataProtocol; message: string } // message — рус.

// domain/phaseMachine.ts — чистый TimerEngine (без Vue/Audio/Dexie)
export type PhaseKind = 'prepare' | 'work' | 'rest' | 'restBetweenCycles' | 'done';
export interface MachineState {
  phase: PhaseKind;
  phaseIndex: number;       // порядковый номер фазы от старта сессии
  round: number;            // 1..rounds
  cycle: number;            // 1..cycles
  phaseEndsAt: number;      // метка (ms), когда фаза сменится
  remainedMs: number;       // вычисляется: max(0, phaseEndsAt - now)
  completedRounds: number;  // фактически завершённые раунды
  pausedAt: number | null;  // метка, если стоит пауза
  protocol: TabataProtocol; // ссылка на протокол сессии (длина фаз нужна tick/pause/resume)
}
export function createMachine(p: TabataProtocol, now: () => number): MachineState;
export function tick(s: MachineState, now: number): MachineState;        // чистый; мутации через замену
export function pause(s: MachineState, now: number): MachineState;
export function resume(s: MachineState, now: number): MachineState;      // сдвигает phaseEndsAt на длительность паузы
export function reset(p: TabataProtocol, now: number): MachineState;
export function hasFinished(s: MachineState): boolean; // s.phase === 'done'

// db/db.ts (Dexie, IndexedDB)
export interface WorkoutTemplate {
  id?: number; name: string; protocol: TabataProtocol; isPreset: boolean;
}
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';
export interface TrainingSession {
  id?: number;
  startedAt: number;           // Date.now() при старте
  finishedAt?: number;
  templateId?: number;         // отсутствует для пресетов или удалённых шаблонов
  templateName: string;        // снимок имени (переживает переименование/удаление)
  protocolSnapshot: TabataProtocol;
  completedRounds: number;
  status: SessionStatus;
}
export const db: Dexie; // tables: templates, sessions

export const templatesRepo = {
  list(): Promise<WorkoutTemplate[]>;
  create(name: string, protocol: TabataProtocol): Promise<WorkoutTemplate>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
};
export const sessionsRepo = {
  save(s: TrainingSession): Promise<void>;     // upsert по завершении/прерывании (со статусом completed|abandoned)
  recent(limit: number): Promise<TrainingSession[]>;
};

// audio/audioCues.ts
export type BeepType = 'tickLow' | 'phaseSwitchHigh' | 'restStart' | 'sessionFinish';
// sessionFinish = три бипа; restStart = два средних высоких бипа; tickLow — последний 3-секундный отсчёт
export function beepsForTransition(prev: MachineState, next: MachineState, proto: TabataProtocol): BeepType[];
export function beep(ctx: AudioContext, type: BeepType): void; // осциллятор, без аудиофайлов
// AudioContext создаётся лениво по первому пользовательскому действию (autoplay-политики)
```

### Диаграмма фаз

```
prepare → work → rest ┐
          ↑   └───────┤ (× rounds)
          └───────────┘
rest (последнего раунда) ─→ restBetweenCycles (если cycle < cycles) → work…
                    └→ done (если cycles = 1 или завершён последний цикл)
```

### Пресеты (`presets.ts`)

```ts
export const PRESETS: WorkoutTemplate[] = [
  { name: 'Табата 20/10 × 8 раундов',           protocol: { prepareSec: 10, workSec: 20, restSec: 10, rounds: 8, cycles: 1, restBetweenCyclesSec: 60 }, isPreset: true },
  { name: 'Табата 20/10 × 8 раундов × 2 цикла',  protocol: { …, cycles: 2 }, isPreset: true },
];
```

## Модель данных

См. выше `WorkoutTemplate` и `TrainingSession`; соответствует `docs/architecture.md`. Ключевые решения:

- `protocols` как отдельная таблица **не заводится**: протокол — часть шаблона (`WorkoutTemplate.protocol`).
- Пресеты **не** пишутся в Dexie (неизменяемы, живут в `presets.ts`); Dexie хранит только пользовательские шаблоны (`isPreset: false`).
- В `TrainingSession` хранятся `protocolSnapshot` и `templateName` — снимки на момент запуска: история стабильна при переименовании/удалении шаблона (AC-7). `templateId` необязателен (пресеты/удалённые шаблоны).
- Статус `in_progress` существует в enum по модели архитектуры, но запись в историю создаётся уже с финальным статусом (`completed|abandoned`) — persisted `in_progress`-сессии в MVP нет; активная сессия живёт только в памяти (восстановление после закрытия вкладки — вне объёма).

## Отклонения, согласованные при реализации (rev. 2026-10-15)

- `MachineState` содержит поле `protocol: TabataProtocol`; `reset(p, now)` принимает протокол и метку времени — иначе FSM не может вычислять длительности фаз и «вернуться к началу протокола».
- `completedRounds` инкрементируется на переходе работа → отдых (IC5 semantics: «прервано на 3-м раунде (завершён 3-й)»).
- Редактирование пользовательского шаблона = переименование; поля протокола в режиме редактирования задизейблены (`update`-операции в контракте нет — протокол неизменяем).
- Роутинг экранов — состояние `ref` в `App.vue` (без vue-router).
- Дополнительно к списку зависимостей plan.md (все оправданы ревью): runtime `workbox-window` (импортируется `virtual:pwa-register`), dev `vue-tsc` (type-check build), dev `jsdom` (vitest env для компонент-тестов).
- Прерывание: `pagehide` → сохранение `abandoned`; скрытие вкладки сессию не завершает (см. spec FR-4).
- `pnpm-workspace.yaml` содержит `allowBuilds: esbuild` (pnpm 12 блокирует postinstall по умолчанию).

## Тест-план

Инструменты: `vitest` (unit, fake timers), `@vue/test-utils` (компоненты) — см. риски ниже; E2E-браузерный прогон — вручную по AC (Chrome DevTools + реальный Android/iOS) из-за ограничений vitest.

1. **protocol.test.ts** (unit, чистые функции):
   - значения по умолчанию соответствуют FR-5;
   - валидация: `<= 0` в любом поле → ошибка поля; `rounds` 0/31 → ошибка; `cycles` 0/11 → ошибка; граничные значения 1/30/10 валидны.
2. **phaseMachine.test.ts** (unit, fake timers / подмена `now`):
   - последовательность фаз для `{cycles:1}`: prepare → 8 × (work→rest) → done; restBetweenCycles не встречается (AC-1, AC-3).
   - `{cycles:2}`: после 8-го раунда — restBetweenCycles 60 с → 2-й цикл; итерации 16 (AC-2).
   - pause/resume: отсчёт возобновляется с того же remainedMs; пауза не двигает фазы и не добавляет дрейф.
   - reset возвращает к «подготовке».
   - **дрейф-тест NFR-1**: прогон 30 мин симуляции с fake timers, уточняющими tick-и; расхождение эталонного расписания фаз < 50 мс.
   - `completedRounds` корректен при прерывании на середине раунда (AC-5 → unit-уровень).
3. **beepPlan.test.ts** (unit): чистая функция `beepsForTransition` возвращает ожидаемые BeepType для границ фаз (в т.ч. двойной подсчёт, три бипа на завершение).
4. **repositories.test.ts** (unit, Dexie + `fake-indexeddb`): create/rename/remove шаблонов; сохранение сессии completed/abandoned; `recent()` сортировка по дате; удаление шаблона не удаляет сессии.
5. **Компоненты** (@vue/test-utils, если легко изолируется, иначе ручной чек):
   - SetupScreen: валидация протокола блокирует сохранение (AC-6);
   - TimerScreen: пауза/продолжение/сброс обновляют UI-состояние.
6. **Ручная приёмка на устройстве**: AC-8 (звук), AC-9 (авиарежим), AC-10 (safe area/readable), AC-12 (GitHub Pages installable).
7. **Регресс**: `pnpm -r test` зелёный в CI (ci.yml).

### Риски и смягчение

- **Точность звука на фоне/пауза вкладки** — браузер может троттлить `setInterval` при сне вкладки: рендер и бипы дрейфуют на несколько сотен мс; зафиксировано в spec.md как не-требование; отсчёт при возврате корректируется по `endsAt`.
- **AudioContext autoplay-политика** — создаётся/резюмится по первому пользовательскому клику (кнопка старта).
- **IndexedDB на приватных страницах Safari** — первичная цель — установленная PWA; ручная проверка (AC-9).
- **Расхождение fake-indexeddb vs реальный IndexedDB** — риск мал: Dexie-таблицы простые (key-path, одиночные индексы).
