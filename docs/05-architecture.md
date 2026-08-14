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

```
sd-flow/
├── src/
│   ├── engine/                        ← ядро, без React
│   │   ├── ComponentRegistry.ts       ← синглтон-реестр (аналог PluginRegistry)
│   │   ├── TopologyCompiler.ts        ← валидация, SCC, дерево вызовов
│   │   ├── SimulationEngine.ts        ← оркестратор шагов 2–6
│   │   ├── solvers/
│   │   │   ├── FlowSolver.ts          ← распространение λ, итерации, ретраи
│   │   │   ├── CapacityKernel.ts      ← ёмкость и boundBy
│   │   │   ├── QueueModel.ts          ← G/G/c, Сакасэгава + Аллен–Каннин
│   │   │   ├── LatencyMonteCarlo.ts   ← свёртка задержек, квантили
│   │   │   ├── CacheModel.ts          ← Zipf, hit ratio, прогрев
│   │   │   ├── GeoRoutingModel.ts     ← гео-профиль → регион, RTT-матрица
│   │   │   ├── MultiRegionModel.ts    ← режимы репликации, трафик, RPO/RTO
│   │   │   ├── ConsistencyModel.ts    ← аномалии A1–A8 и средства смягчения
│   │   │   ├── StorageModel.ts        ← данные, логи, метрики, бэкапы
│   │   │   ├── CostModel.ts           ← стоимость по профилям цен
│   │   │   └── AvailabilityModel.ts   ← девятки, SPOF, домены отказа
│   │   ├── scenarios/                 ← baseline, peak, az-failure, …
│   │   ├── rules/                     ← RuleEngine: антипаттерны и best practices
│   │   ├── challenges/                ← движок предикатов, рубрика, вердикт
│   │   ├── components/                ← ОПРЕДЕЛЕНИЯ БЛОКОВ по группам
│   │   │   ├── _shared/               ← общие хелперы ёмкости и стоимости
│   │   │   ├── clients/  edge/  compute/  sql/  nosql/  search/
│   │   │   ├── olap/  cache/  messaging/  storage/  platform/
│   │   │   └── observability/  topology/  probes/
│   │   ├── types/                     ← Scheme, Node, Edge, Flow, Metrics, Findings
│   │   ├── rng.ts                     ← xoshiro128**
│   │   └── initComponents.ts          ← регистрация групп, опций и всех блоков
│   ├── worker/
│   │   ├── simulation.worker.ts
│   │   └── workerClient.ts            ← Comlink-обёртка, отмена, генерации
│   ├── store/                         ← Zustand slices
│   │   ├── schemeStore.ts   graphStore.ts   simulationStore.ts
│   │   ├── challengeStore.ts   uiStore.ts
│   ├── components/
│   │   ├── canvas/                    ← SdEditor, SdNode, edges/*, groups/*
│   │   ├── panels/                    ← Palette, Inspector, Dock, RequirementsPanel
│   │   ├── dashboards/                ← SummaryBar, Findings, Waterfall, CostBreakdown
│   │   ├── probes/                    ← окна измерителей
│   │   ├── dialogs/                   ← Save/Load/Settings/Help/Confirm/Verdict
│   │   ├── challenges/                ← Catalog, Briefing, Report, ReferenceDiff
│   │   ├── layout/                    ← Header, Footer, ControlToolbar
│   │   └── common/                    ← Dialog, ErrorBoundary, Icon, SdIcons
│   ├── hooks/                         ← useSimulation, useSchemeStorage, useAutoSave, …
│   ├── contexts/                      ← ThemeContext, TouchContext
│   ├── data/
│   │   ├── defaults/                  ← latency.json, capacities.json, pricing-*.json
│   │   ├── presets/                   ← инстансы, шаблоны подсхем
│   │   ├── challenges/                ← YAML-задания (компилируются при сборке)
│   │   └── help/                      ← справка по блокам
│   ├── locales/                       ← ru/en × {common, blocks, groups, params, help, validation, challenges}
│   ├── services/                      ← storage, share-link, export
│   ├── styles/                        ← variables.css, index.css
│   └── utils/
├── tests/
│   ├── engine/                        ← solvers, compiler, registry
│   ├── components/                    ← по одному файлу на группу блоков
│   ├── golden/                        ← эталонные схемы + снапшоты метрик
│   ├── challenges/                    ← прогон эталонных решений через приёмку
│   └── integration/
├── docs/                              ← этот каталог
├── scripts/                           ← компиляция YAML-заданий, генерация OG-картинки
└── .github/workflows/deploy.yml
```

---

## 3. ComponentRegistry и определение блока

Контракт блока — прямой аналог `PluginDefinition` из dsp-flow, где вместо `processor.process()`
стоят чистые функции модели.

```ts
export interface ComponentDefinition<P extends ComponentParams = ComponentParams> {
  id: ComponentTypeId;
  group: GroupId;
  icon: string;
  ports: PortSpec;
  defaultParams: P;
  paramSchema: ParamSchema<P>;
  realisticRanges: Partial<Record<keyof P, NumericRange>>;
  capacity(ctx: NodeContext<P>): CapacityResult;
  derive?(ctx: NodeContext<P>): DerivedMetrics;
  absorb?(ctx: NodeContext<P>, edge: CompiledEdge): number;
  cost(ctx: NodeContext<P>): CostBreakdown;
  availability?(ctx: NodeContext<P>): AvailabilitySpec;
  lint?(ctx: NodeContext<P>): Finding[];
  helpId: string;
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
  icon: 'sd-postgres',
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
  realisticRanges: { maxConnections: [10, 5000], readServiceMs: [0.1, 500] },
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
  helpId: 'postgres',
};
```

Реестр повторяет поведение dsp-flow: `register()`, `registerGroup()`, `registerParamOptions()`,
`freeze()` после `initComponents()`, запрет регистрации в рантайме.

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

**Фаза 0 (скелет), порядок работ:**

1. Форкнуть каркас: `vite.config`, `eslint.config`, `tsconfig`, `.github/workflows/deploy.yml`,
   `styles/`, `common/` (Dialog, ErrorBoundary, Icon), `contexts/`, `locales/i18n.js`,
   `services/storageService`, хуки `useTheme`/`useAutoSave`/`useDialogManager`/`useSchemeStorage`.
2. Перенести `Toolbar` и `Header`/`Footer`, переключив источник данных на заглушку `ComponentRegistry`.
3. Перенести `DSPEditor` → `SdEditor`: канвас, drag&drop, контекстное меню, touch.
4. Заменить `RealSignalEdge`/`ComplexSignalEdge` на `TrafficEdge` (пока без метрик).
5. Ввести `ComponentRegistry` + 15 блоков-заглушек с `defaultParams` и портами.
6. Поднять группы-контейнеры (parent-nodes React Flow) сразу в фазе 0 — Region/AZ нужны в MVP
   (ADR-11), а ретрофитить группировку в готовый канвас заметно дороже, чем заложить её сразу.

После этого получается работающий редактор схем без модели — и уже можно строить движок.

**Что НЕ переносим:** всё содержимое `engine/plugins/**` (DSP-алгоритмы), `visualization/**`
(осциллограф/спектр/созвездие), `MicrophoneService`, `WavFileService`, Web Audio-слой.

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
