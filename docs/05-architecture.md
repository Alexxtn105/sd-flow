# 05. Техническая архитектура

Приложение к [PRD.md](../PRD.md). Как это устроено внутри и что переиспользуется из `dsp-flow`.

---

## 1. Принципы

1. **Блоки — это данные, а не код.** Добавление нового компонента = один модуль с декларативным
   описанием параметров и чистыми функциями `capacity`/`derive`/`cost`. Никаких правок ядра.
   Прямое наследование идеи `PluginRegistry` из dsp-flow.
2. **Ядро — чистые функции.** Симуляция не знает про React, DOM и i18n. Её можно запускать в Node,
   в тесте и в воркере.
3. **Один источник истины для схемы.** Всё состояние графа — в одном store; UI и движок читают одно
   и то же.
4. **Детерминизм.** Ни одного `Math.random()` и `Date.now()` в ядре — только seeded PRNG и
   переданное время.
5. **Всё объяснимо.** Каждая производная метрика возвращает не только число, но и `explain`:
   формулу, входы и ограничитель.

---

## 2. Структура репозитория

Ниже — фактическое дерево после фазы 1. Каталоги, помеченные *(фаза 2+)*, ещё не созданы.

```
sd-flow/
├── src/
│   ├── engine/                        ← ядро, без React, DOM и i18n
│   │   ├── ComponentRegistry.ts       ← синглтон-реестр (аналог PluginRegistry)
│   │   ├── ports.ts                   ← совместимость портов по протоколам
│   │   ├── edgeDefaults.ts            ← профили вызова по умолчанию + посев payload
│   │   ├── ids.ts                     ← счётчик идентификаторов без Math.random
│   │   ├── initComponents.ts          ← регистрация групп и всех блоков
│   │   ├── types/
│   │   │   ├── component.ts           ← ComponentDefinition, ComponentModel, контексты
│   │   │   └── scheme.ts              ← SchemeV1, CallProfile, EdgePolicy, настройки
│   │   ├── sim/                       ← шаги 1–7 модели симуляции
│   │   │   ├── types.ts               ← SimResult: узлы, рёбра, потоки, итоги, находки
│   │   │   ├── rng.ts                 ← xoshiro128** + хэш схемы
│   │   │   ├── constants.ts           ← RTT-матрица гео-зон, профили цен, календарь
│   │   │   ├── resources.ts           ← билдеры ограничителей ёмкости + defineModel
│   │   │   ├── compile.ts             ← [1] валидация, SCC, порядок, размещение, RTT
│   │   │   ├── flows.ts               ← λ из клиентских блоков
│   │   │   ├── solver.ts              ← [2] распространение λ, ретраи, поглощение
│   │   │   ├── queueing.ts            ← [4] Сакасэгава + Аллен–Каннин, p_fail
│   │   │   ├── cacheModel.ts          ← [6] Ципф, hit ratio, горячий ключ
│   │   │   ├── latency.ts             ← [5] Monte-Carlo по дереву вызовов
│   │   │   ├── consistency.ts         ← [5а] аномалии A1, A2, A4, A5, A6
│   │   │   ├── derived.ts             ← [6] хранилище, логи, egress
│   │   │   ├── cost.ts                ← [6б] стоимость по профилям цен
│   │   │   ├── availability.ts        ← девятки с резервированием, SPOF
│   │   │   ├── multiRegion.ts         ← доли регионов, репликация, RPO/RTO
│   │   │   ├── scenarios.ts           ← 7 сценариев фазы 1
│   │   │   ├── findings.ts            ← [7] RuleEngine
│   │   │   └── simulate.ts            ← оркестратор, отдаёт SimResult
│   │   └── components/                ← ОПРЕДЕЛЕНИЯ БЛОКОВ, один модуль на группу
│   │       ├── _shared/params.ts      ← хелперы num/bool/choice/text/defineComponent
│   │       ├── clients.ts  edge.ts  compute.ts  sql.ts  nosql.ts  search.ts
│   │       ├── olap.ts  cache.ts  messaging.ts  storage.ts  platform.ts
│   │       └── observability.ts  topology.ts  probes.ts
│   ├── workers/simulation.worker.ts   ← расчёт вне главного потока
│   ├── store/                         ← Zustand: graphStore, schemeStore, uiStore, simStore
│   ├── components/
│   │   ├── canvas/                    ← SdEditor, SdNode, GroupNode, ProbeNode, TrafficEdge
│   │   ├── panels/                    ← Palette, Inspector, Dashboard
│   │   ├── dialogs/                   ← Save, Load, Confirm
│   │   ├── layout/                    ← Header, Footer
│   │   └── common/                    ← Dialog, ErrorBoundary, Icon, SdIcons, ResizeHandle
│   ├── hooks/                         ← useSimulation, useAutoSave, useDialogManager, useTheme
│   ├── contexts/                      ← ThemeContext, TouchContext
│   ├── data/demoSchemes.ts            ← демо-схемы, они же приёмка Definition of Done
│   ├── locales/                       ← ru/en × {common, blocks, groups, params}
│   ├── services/                      ← storage, файлы, сериализация, конструктор схем, воркер
│   ├── styles/                        ← variables.css, index.css
│   └── utils/                         ← format.ts, panelSize.ts (границы размеров панелей)
├── tests/
│   ├── engine/                        ← реестр, каталог, порты, сериализация, модель, демо
│   ├── store/                         ← graphStore, uiStore
│   └── helpers/                       ← конструктор схем для тестов
├── docs/                              ← этот каталог
└── .github/workflows/deploy.yml
```

**Чего пока нет** *(фаза 2+)*: `engine/challenges/`, `data/challenges/` (YAML-задания),
`data/defaults/*.json` (константы живут в `sim/constants.ts` и в дефолтах блоков),
`components/probes/` (окна измерителей), `tests/golden/`, `scripts/`.

---

## 3. ComponentRegistry и определение блока

Контракт блока — прямой аналог `PluginDefinition` из dsp-flow, где вместо `processor.process()`
стоят чистые функции модели.

```ts
export interface ComponentDefinition<P extends ComponentParams = ComponentParams> {
  id: ComponentTypeId;
  group: GroupId;
  shape: 'node' | 'container' | 'policy' | 'probe' | 'link';
  wave: 'mvp' | 'v1' | 'v2';
  icon: string;
  ports: PortSpec;
  defaultParams: P;
  paramSchema: ParamSchema<P>;
  helpId: string;
  model?: ComponentModel<P>;
}

export interface ComponentModel<P extends ComponentParams = ComponentParams> {
  capacity(ctx: NodeContext<P>): CapacityResult;
  derive?(ctx: NodeContext<P>): DerivedMetrics;
  absorb?(ctx: NodeContext<P>, edge: CompiledEdge): number;
  cost(ctx: NodeContext<P>): CostBreakdown;
  availability?(ctx: NodeContext<P>): AvailabilitySpec;
  lint?(ctx: NodeContext<P>): Finding[];
}

export interface CapacityResult {
  limits: Array<{ resource: string; value: number; explain: Explain }>;
  capacity: number;
  boundBy: string;
}

export interface Explain {
  formula: string;
  inputs: Record<string, number | string>;
  result: number;
  unit: string;
}
```

Пример (сокращённо):

```ts
const postgres: ComponentDefinition<PostgresParams> = {
  id: 'postgres',
  group: 'sql',
  shape: 'node',
  wave: 'mvp',
  icon: 'sd-sql',
  ports: {
    in: [{ id: 'sql', protocols: ['sql'], role: 'serve' }],
    out: [{ id: 'replication', protocols: ['sql'], role: 'replicate' },
          { id: 'cdc', protocols: ['kafka'], role: 'emit' }],
  },
  defaultParams: {
    instanceClass: 'db.r6g.2xlarge', maxConnections: 200, connectionPooler: 'none',
    readServiceMs: 0.8, writeServiceMs: 3, provisionedIops: 12000,
    iopsPerRead: 1, iopsPerWrite: 4, readReplicas: 0, replicationMode: 'async',
    rowSizeBytes: 400, indexOverhead: 0.4, bufferPoolGb: 48, storageGb: 1000,
  },
  paramSchema: {
    maxConnections: num('capacity', { min: 10, max: 5000 }),
    readServiceMs: num('performance', { unitKey: 'ms', min: 0.1, max: 500 }),
    connectionPooler: choice('capacity', ['none', 'pgbouncer', 'rds-proxy']),
    // …по одной записи на каждый ключ defaultParams
  },
  helpId: 'postgres',
  model: {
    capacity: (ctx) => kernel(ctx, [
      limitConnections(ctx), limitIops(ctx), limitCpu(ctx), limitNetwork(ctx),
    ]),
    derive: (ctx) => ({
      storageGrowthGbDay: storageGrowth(ctx),
      replicaLagMs: replicaLag(ctx),
      bufferHitRatio: bufferPoolHit(ctx),
    }),
    cost: (ctx) => instanceCost(ctx) + storageCost(ctx) + iopsCost(ctx) + backupCost(ctx),
    availability: (ctx) => ({ base: 0.9995, failoverSec: ctx.params.multiAz ? 60 : 300 }),
    lint: (ctx) => [ruleNoPooler(ctx), ruleRf1(ctx), ruleBlobInSql(ctx)],
  },
};
```

Реестр повторяет поведение dsp-flow: `register()`, `registerGroup()`, `freeze()` после
`initComponents()`, запрет регистрации в рантайме.

**Три отличия от dsp-flow, зафиксированные в фазе 0:**

1. **Модель вынесена в необязательный слот `model`.** Декларативная часть блока (порты,
   значения по умолчанию, схема параметров) не зависит от того, посчитан ли уже его capacity.
   Это позволило описать весь каталог первой волны до появления солверов и не выдумывать
   фиктивные формулы ради удовлетворения контракта.
2. **`realisticRanges` слит с `paramSchema`.** Границы `min`/`max`/`realistic` живут прямо в
   описании поля, иначе один и тот же диапазон приходится держать в двух местах.
3. **`registerParamOptions()` не реализован.** Варианты enum лежат в самом `paramSchema`
   (`choice('behaviour', [...])`), где они проверяются типами и относятся к конкретному блоку;
   глобальный словарь опций по имени параметра давал бы ложное единство (`mode` у `redis` и
   `mode` у `multi-region-policy` — разные множества).

`register()` дополнительно проверяет, что множества ключей `defaultParams` и `paramSchema`
совпадают один в один — это ловит опечатку в имени параметра при старте приложения, а не при
первом открытии инспектора.

---

## 4. Формат схемы и миграции

```ts
interface SchemeV1 {
  version: 1;
  modelVersion: string;
  meta: { id: string; name: string; description?: string; createdAt: string; updatedAt: string;
          challengeId?: string; author?: string; tags?: string[] };
  nodes: SchemeNode[];
  edges: SchemeEdge[];
  groups: SchemeGroup[];
  flows: Flow[];
  probes: Probe[];
  settings: {
    pricingProfile: string;
    seed: number;
    scenario: ScenarioId;
    units: 'si' | 'binary';
    consistencyModel: 'off' | 'attribute' | 'anomalies';
    modelDepth: 'learning' | 'standard' | 'expert';
  };
  ui: { viewport: Viewport; collapsedGroups: string[]; xray: boolean };
}
```

* Хранение — `localStorage` через `StorageService` (лимит ≥ 4 МБ, ≥ 50 схем, автосейв с debounce),
  прямо как в dsp-flow.
* Экспорт/импорт — тот же JSON.
* Шаринг — `lz-string` в `location.hash`; при превышении ~8 КБ предлагается файл.
* Миграции — цепочка `migrations[from → to]`, как `LEGACY_TYPE_TO_ID` в dsp-flow, но обобщённая:
  каждая версия формата и каждая версия модели имеет мигратор, схемы никогда не «протухают».

---

## 5. Движок и воркер

### 5.1. Протокол

```ts
type WorkerRequest =
  | { type: 'simulate'; gen: number; scheme: SchemeV1; scenario: ScenarioId; quality: 'preview' | 'full' }
  | { type: 'battery'; gen: number; scheme: SchemeV1; scenarios: ScenarioId[] }
  | { type: 'sweep'; gen: number; scheme: SchemeV1; flowId: string }
  | { type: 'grade'; gen: number; scheme: SchemeV1; challenge: CompiledChallenge };

type WorkerResponse =
  | { type: 'result'; gen: number; result: SimulationResult }
  | { type: 'progress'; gen: number; done: number; total: number }
  | { type: 'error'; gen: number; error: EngineError };
```

Каждый запрос несёт номер поколения `gen`; ответы с устаревшим `gen` игнорируются. Долгие операции
(`battery`, `sweep`) шлют `progress` и проверяют флаг отмены между сценариями.

### 5.2. Инкрементальность

Хэш подграфа (структура + параметры) кэширует результат шагов 2–4. При правке одного параметра
пересчитывается только затронутый узел и всё, что ниже по потоку; Monte-Carlo пересчитывается
целиком, но с уменьшенным N в режиме preview.

### 5.3. Capacity sweep

Бинарный поиск множителя трафика `m ∈ [1, 1000]`: 12–16 итераций steady-state (без Monte-Carlo)
≈ 20 мс. Возвращает предельный RPS и узел-ограничитель.

---

## 6. Состояние приложения

| Slice | Содержимое |
|---|---|
| `graphStore` | nodes, edges, groups, выделение, undo/redo (patch-based через Immer) |
| `schemeStore` | метаданные, список сохранённых схем, автосейв, импорт/экспорт |
| `simulationStore` | последний `SimulationResult`, статус, выбранный сценарий, seed, X-ray |
| `challengeStore` | активное задание, состояние требований, попытки, подсказки, прогресс |
| `uiStore` | панели, тема, язык, зум, открытые окна проб |

Undo/redo — на патчах Immer, ограничение 100 шагов. Тема и язык остаются в Context (как в dsp-flow):
меняются редко, глобальны.

---

## 7. UI: что делаем так же, что иначе

| Компонент dsp-flow | Решение в SysDesign Flow |
|---|---|
| `Toolbar` (палитра с группами, поиском, свёрткой, «?»-справкой, легендой) | **Переиспользуем структуру целиком**, меняем источник данных на `ComponentRegistry` |
| `BlockNode` (инлайн-параметры, порты, поповер) | Переписываем: добавляются бейджи метрик, бар утилизации, LOD |
| `RealSignalEdge` / `ComplexSignalEdge` | Основа для `TrafficEdge` (1–2 жилы, анимация, цвет по состоянию) |
| `BlockParamsPopover` | Переиспользуем как быстрый редактор; полный редактор — правая панель `Inspector` |
| `VisualizationWindow` / `VisualizationManager` | Переиспользуем как систему плавающих окон для проб |
| `Dialog`, `ConfirmDialog`, `SaveDialog`, `LoadDialog`, `SettingsDialog`, `ErrorBoundary` | **Копируем практически как есть** |
| `Icon` / `DspIcons` | Копируем механику, свой набор `SdIcons` |
| `ThemeContext`, `TouchContext`, `TouchContextMenu` | **Копируем как есть** |
| `ControlToolbar` (play/stop/manual) | Становится панелью управления симуляцией: пуск/пауза, сценарий, скорость, seed |
| `CanvasHelpDialog`, `BlockHelpDialog` | Копируем; наполнение — своё |
| `useTheme`, `useAutoSave`, `useDialogManager`, `useSchemeStorage` | **Копируем как есть** |
| `useDSPSimulation` | Переписываем в `useSimulation` (worker, debounce, отмена, прогресс) |
| `storageService`, `fileStorageService`, `validationService` | Копируем базу, расширяем |
| `locales/i18n.js` + неймспейсы | **Копируем как есть**, добавляем неймспейс `challenges` |
| `styles/variables.css` | Копируем, добавляем токены трафика и состояний утилизации |

---

## 8. i18n

Как в dsp-flow: машинные ID блоков (`kebab-case`), отображаемые имена — в `locales/{lang}/blocks.json`,
группы — `groups.json`, параметры — `params.json`, справка — `help.json`, валидация и Findings —
`validation.json`, задания — `challenges.json`. Продакшн-языки: **ru, en**.

Отдельное правило: **все сообщения Findings и вердиктов приёмки — только через ключи i18n с
параметрами-числами**, никаких склеенных строк, иначе перевод разъедется.

---

## 9. Тестирование

| Слой | Что тестируем | Инструмент |
|---|---|---|
| Формулы | Каждый солвер: предельные случаи, размерности, сверка с точными формулами очередей | Vitest, property-based (fast-check) |
| Блоки | Для каждого типа: `capacity` даёт ожидаемый `boundBy` на подготовленном контексте | Vitest, по файлу на группу |
| Компилятор | Циклы, SCC, несовместимые порты, несвязные компоненты | Vitest |
| Золотые схемы | 12 эталонных схем → снапшот полного `SimulationResult` | Vitest snapshots |
| Приёмка | Каждое эталонное решение каждого задания **обязано** получать 3 звезды; каждое «плохое» решение из набора — падать на ожидаемом требовании | Vitest, регрессия при правке формул |
| Детерминизм | Один и тот же seed → идентичный результат, 100 прогонов | Vitest |
| Производительность | Схема на 100 узлов < 100 мс; батарея < 1.5 с | Vitest bench |
| UI | Критические потоки: добавить блок, соединить, сдать задание | Vitest + Testing Library; e2e — Playwright (v1.0) |

Цель покрытия ядра — ≥ 85%.

---

## 10. CI/CD

Копия пайплайна dsp-flow с добавлением шагов:

```
install → lint → typecheck → test → compile-challenges (YAML→JSON) → build → deploy (GitHub Pages)
```

Дополнительно в PR: бенчмарк производительности движка и дифф золотых снапшотов в комментарии.

---

## 11. Производительность: конкретные меры

| Мера | Эффект |
|---|---|
| Расчёт в Web Worker | UI не блокируется никогда |
| Инкрементальный пересчёт по хэшу подграфа | Правка параметра — единицы мс |
| N сэмплов Monte-Carlo: 4 000 в preview / 20 000 в full | Плавные ползунки |
| Анимация рёбер на CSS (`stroke-dashoffset`), не в JS | 300+ рёбер без просадки |
| LOD: скрытие метрик и анимации при зуме < 0.5–0.6 | Крупные схемы остаются интерактивными |
| `React.memo` + селекторы Zustand на каждый узел | Перерисовывается только изменившийся узел |
| Виртуализация списка блоков в палитре при > 60 элементов | Быстрый поиск |
| Типизированные массивы для метрик Monte-Carlo (`Float64Array`) | Меньше GC |

---

## 12. План переиспользования кода из dsp-flow

**Фаза 0 (скелет) — выполнена.** Что и как перенесено:

| Из dsp-flow | Стало в SysDesign Flow | Степень переноса |
|---|---|---|
| `vite.config`, `eslint.config`, `tsconfig`, `deploy.yml` | те же, `base: '/sd-flow/'`, всё на TypeScript | каркас |
| `styles/variables.css` | + токены трафика (`--traffic-read/write/replication/event/stream/batch`), утилизации и групп | расширен |
| `Dialog`, `ErrorBoundary`, `Icon` | те же, `DspIcons` → `SdIcons` (43 родовые иконки, без вендорских логотипов, ADR-10) | почти как есть |
| `ThemeContext`, `TouchContext`, `useTheme` | как есть, переписаны на TS | как есть |
| `locales/i18n.js` + неймспейсы | `i18n.ts`, языки ru/en, неймспейсы `common`/`blocks`/`groups`/`params` | как есть |
| `storageService` | ключи `sd-*`, типизированный `SaveResult`, guard на отсутствие `localStorage` (нужен для тестов в Node) | переписан |
| `Toolbar` | `Palette`: та же структура (поиск, свёртка групп, «свернуть всё», легенда внизу), источник данных — `ComponentRegistry` | структура целиком |
| `Header`/`Footer` | + переключатель режимов, файловые действия, undo/redo; футер считает блоки/связи/группы | расширены |
| `DSPEditor` | `SdEditor`: drag&drop, контекстное меню, MiniMap, вложение в контейнеры при drop | переписан |
| `RealSignalEdge`/`ComplexSignalEdge` | `TrafficEdge`: 1–2 жилы по профилям вызова, цвет по операции, штрих по `kind`, прозрачность по доле | развитие приёма |
| `BlockNode` | `SdNode` (+ `GroupNode` с `NodeResizer`, `ProbeNode`) | переписан |
| `DSPEditorContext` (Context API) | `graphStore`/`schemeStore`/`uiStore` на Zustand (ADR-2) | заменён |

Отклонения от исходного плана: блоков описано не 15, а все **44** первой волны (см. PRD §12);
`registerParamOptions` не реализован (см. §3).

**Что НЕ переносим:** всё содержимое `engine/plugins/**` (DSP-алгоритмы), `visualization/**`
(осциллограф/спектр/созвездие), `MicrophoneService`, `WavFileService`, Web Audio-слой.

### 12.1. Что добавила фаза 1

Движок целиком свой — из dsp-flow здесь не переиспользуется ничего, кроме идеи реестра.

| Появилось | Где | Суть |
|---|---|---|
| Слот модели у блока | `types/component.ts` | `ComponentModel` = `serviceSec` + `capacity` (+ опционально `autoscale`, `cost`, `storage`, `availability`, `cache`). Заполнен у всех блоков MVP, несущих трафик |
| Декларативные ограничители | `sim/resources.ts` | `littleLaw`, `explicitRps`, `connectionBound`, `iopsBound`, `vendorUnitBound`, `bandwidthBound`, `partitionBound`, `quotaBound`, `memoryResidencyBound`. Каждый отдаёт `Explain` с формулой и подставленными значениями, поэтому `boundBy` всегда объясним |
| Расчёт вне UI | `workers/simulation.worker.ts`, `services/simulationService.ts` | Web Worker с отбрасыванием устаревших ответов; в Node и при отказе воркера — синхронный fallback через динамический импорт |
| Метрики на канвасе | `SdNode`, `TrafficEdge` | Полоса утилизации с цветом по порогу, RPS, переведённое имя ограничителя; толщина жилы по RPS, красный отлив при ρ > 0.8, подписи в X-ray |
| Панель результатов | `panels/Dashboard` | Итоги, потоки с квантилями, находки с переходом на узел, аномалии согласованности, мультирегион с RPO/RTO |
| Демо-схемы | `data/demoSchemes.ts` | «Видеоплатформа» и «Платежи в двух регионах» — они же приёмочный тест фазы |

Известное ограничение визуализации: формула толщины из
[03-connections.md](03-connections.md) §5.1 — `w = clamp(1 + 1.6·log10(rps), 1, 8)` — насыщается
при `rps ≳ 24k`, поэтому на схемах масштаба «Видеоплатформы» почти все жилы получают максимальную
толщину. Формула оставлена абсолютной намеренно: только так легенда «толщина ↔ RPS» осмысленна и
сравнима между схемами.

### 12.2. Что осталось на следующие фазы

* Пробы (`probe-*`) ставятся на схему и хранятся, но окон измерителей ещё нет.
* Transient-режим, оставшиеся сценарии и аномалии A3/A7/A8 — см.
  [02-simulation.md](02-simulation.md) §15.3, там же полный перечень нереализованного.
* Зеркальные регионы `mirrorOf` (ADR-13): регионы пока описываются явно.
* Инкрементальный пересчёт по хэшу подграфа; сейчас схема считается целиком.
* Режим заданий целиком (фаза 2).

Поведение undo/redo не менялось: в историю пишутся только структурные правки, перетаскивание и
ресайз оформляются транзакцией (`beginTransaction`/`commitTransaction`), а служебные изменения
React Flow (`select`, `dimensions`) не попадают в историю и не помечают схему изменённой.

---

## 13. Решения, принятые заранее (ADR-заготовки)

| # | Решение | Почему |
|---|---|---|
| ADR-1 | TypeScript strict с первого дня | dsp-flow мигрирует по частям и платит за это; здесь модель насыщена числами и юнитами — типы обязательны |
| ADR-2 | Zustand вместо Context для графа | Частые точечные обновления метрик по узлам; Context перерисовывает всё поддерево |
| ADR-3 | Симуляция в Web Worker | Батарея сценариев — сотни миллисекунд CPU |
| ADR-4 | Аналитическая модель + Monte-Carlo вместо полного DES | На порядок быстрее, детерминирована, объяснима формулами; DES оставлен на V2 как альтернативный движок |
| ADR-5 | Циклы в графе разрешены | Ретраи, cache-aside и репликация — легальные циклы; вместо запрета — SCC и итерации |
| ADR-6 | Одно ребро с профилями вызова | См. [03-connections.md](03-connections.md), §3 |
| ADR-7 | Приёмка через предикаты и сценарии, а не сравнение с эталоном | В System Design нет единственного верного графа |
| ADR-8 | Задания в YAML, компилируются при сборке | Удобно писать и ревьюить в PR, дёшево в рантайме |
| ADR-9 | Константы и цены — версионируемые датасеты с `asOf` | Устаревание неизбежно; должно быть видимым и PR-friendly |
| ADR-10 | Никаких вендорских логотипов-ассетов | Юридический риск; свой набор иконок в стиле `DspIcons` |
| ADR-11 | **Мультирегион входит в MVP** (решение D1) | Без него не существует заданий уровня 5, а гео-маршрутизация и межрегиональный лаг — физическая основа модели аномалий. Цена по UI гасится «зеркальными регионами»: регион описывается один раз и инстанцируется N раз |
| ADR-12 | **Согласованность — настройка, по умолчанию симуляция аномалий** (решение D2) | Аналитический расчёт аномалий стоит O(V+E) — единицы миллисекунд, поэтому «дорого» здесь про авторство контента, а не про рантайм. Режимы `выкл`/`атрибут` оставлены для простых заданий и для профиля «Обучение»; задание может зафиксировать режим, иначе задачи про платежи сдаются отключением модели |
| ADR-13 | Регионы-зеркала — не копия узлов, а ссылка `mirrorOf` | Иначе схема на 3 региона утраивает граф, ломает undo/redo и делает правку невыносимой. Зеркало разворачивается в полный граф только внутри движка |
