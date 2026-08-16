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

Ниже — фактическое дерево после фазы 3.

```
sd-flow/
├── src/
│   ├── engine/                        ← ядро, без React, DOM и i18n
│   │   ├── ComponentRegistry.ts       ← синглтон-реестр (аналог PluginRegistry)
│   │   ├── ports.ts                   ← совместимость портов по протоколам
│   │   ├── edgeDefaults.ts            ← профили вызова по умолчанию + посев payload
│   │   ├── ids.ts                     ← счётчик идентификаторов без Math.random
│   │   ├── initComponents.ts          ← регистрация 14 групп и 127 блоков
│   │   ├── types/
│   │   │   ├── component.ts           ← ComponentDefinition, ComponentModel, контексты
│   │   │   ├── scheme.ts              ← SchemeV1, CallProfile, EdgePolicy, настройки
│   │   │   └── index.ts               ← реэкспорт публичных типов ядра
│   │   ├── sim/                       ← шаги 1–8 модели симуляции
│   │   │   ├── types.ts               ← SimResult: узлы, рёбра, потоки, ряды, находки
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
│   │   │   ├── routing.ts             ← гео-маршрутизация: зона клиента → регион, режимы записи
│   │   │   ├── multiRegion.ts         ← доли регионов, репликация, RPO/RTO
│   │   │   ├── transient.ts           ← [8] ход времени: лаг скейлера, очереди, прогрев
│   │   │   ├── probes.ts              ← показания 11 проб, водопад задержки по потоку
│   │   │   ├── scenarios.ts           ← 16 сценариев, из них 10 transient
│   │   │   ├── findings.ts            ← [7] RuleEngine
│   │   │   ├── pipeline.ts            ← решатель + размещение подов одним вызовом
│   │   │   ├── ceiling.ts             ← потолок схемы: бинарный поиск по трафику
│   │   │   └── simulate.ts            ← оркестратор, отдаёт SimResult
│   │   ├── challenges/                ← приёмка заданий, тоже без React и i18n
│   │   │   ├── types.ts               ← Challenge, Requirement, ChallengeVerdict
│   │   │   ├── predicates.ts          ← DSL требований, 13 видов предикатов
│   │   │   ├── realism.ts             ← Realism Gate, 8 проверок «честности» схемы
│   │   │   ├── lint.ts                ← положительные правила и антипаттерны
│   │   │   ├── rubric.ts              ← 7 осей рубрики, звёзды, цена подсказок
│   │   │   └── accept.ts              ← конвейер приёмки, батарея сценариев
│   │   ├── practice/                  ← фаза 4: типы наборов и производные задания (derive.ts)
│   │   ├── authoring/                 ← фаза 4: парсер подмножества YAML, проверка спецификации,
│   │   │                                выгрузка схемы холста, шаблон задания
│   │   └── components/                ← ОПРЕДЕЛЕНИЯ БЛОКОВ, один модуль на группу
│   │       ├── _shared/params.ts      ← хелперы num/bool/choice/text/defineComponent
│   │       ├── clients.ts  edge.ts  compute.ts  sql.ts  nosql.ts  search.ts
│   │       ├── olap.ts  cache.ts  messaging.ts  storage.ts  platform.ts
│   │       └── observability.ts  topology.ts  probes.ts
│   ├── workers/simulation.worker.ts   ← расчёт схемы и приёмка задания вне главного потока
│   ├── store/                         ← Zustand: graphStore, schemeStore, uiStore, simStore, challengeStore
│   ├── components/
│   │   ├── canvas/                    ← SdEditor, SdNode, GroupNode, ProbeNode, ProbeWindows, TrafficEdge,
│   │   │                                CanvasContextMenu (узел, ребро, холст)
│   │   ├── panels/                    ← Palette, Inspector, Dashboard (+ Timeline), Challenges
│   │   ├── tutorial/                  ← Tutorial + tutorialSteps.ts (чистый редьюсер шагов)
│   │   ├── dialogs/                   ← Save, Load, Confirm, ChallengeEditor (конструктор заданий),
│   │   │                                BlockHelpDialog (справка по блоку), SettingsDialog
│   │   ├── layout/                    ← Header, Footer
│   │   └── common/                    ← Dialog, ErrorBoundary, Icon, SdIcons, ResizeHandle, Waterfall
│   ├── hooks/                         ← useSimulation, useAutoSave, useDialogManager, useTheme,
│   │                                    useLocalized (ru/en строки данных), useNodeLabels (имена узлов),
│   │                                    useReference (ленивые словари справки), useParamHelp
│   ├── contexts/                      ← ThemeContext, TouchContext
│   ├── data/
│   │   ├── demoSchemes.ts             ← демо-схемы, они же приёмка Definition of Done
│   │   ├── sampleSchemes.ts           ← список готовых схем шапки: демо + эталоны заданий
│   │   ├── challenges/                ← 23 задания, один модуль на задачу + index.ts
│   │   └── practice/                  ← наборы фазы 4: интервью, инциденты, гольф + разрешение ссылок
│   ├── locales/                       ← ru/en × {common, blocks, groups, nodes, params}
│   │                                    + ленивые {help, hints}: справка по блокам и параметрам
│   ├── services/                      ← storage, файлы, сериализация, конструктор схем, воркеры,
│   │                                    share-link, экспорт PNG и Markdown, service worker,
│   │                                    referenceBundle (догрузка словарей справки)
│   ├── styles/                        ← variables.css, index.css
│   └── utils/                         ← format.ts, panelSize.ts, waterfall.ts (раскладка водопада),
│                                        nodeName.ts (подпись → роль → тип блока),
│                                        paramSections.ts (группировка параметров),
│                                        blockReference.ts (ёмкость блока на дефолтах)
├── public/                            ← иконки, manifest.webmanifest, sw.js (PWA)
├── tests/
│   ├── engine/                        ← реестр, каталог, порты, сериализация, модель, transient, пробы, демо
│   ├── challenges/                    ← приёмка каталога, авторский формат, локали формулировок
│   ├── practice/                      ← наборы «Интервью», «Инцидент», «Гольф»
│   ├── components/                    ← туториал, окна проб, покрытие ключей локалей, имена узлов,
│   │                                    справка по блокам и подсказки к параметрам
│   ├── data/                          ← список готовых схем шапки
│   ├── services/                      ← share-link, экспорт отчёта
│   ├── store/                         ← graphStore, uiStore
│   ├── utils/                         ← раскладка водопада
│   └── helpers/                       ← конструктор схем для тестов
├── docs/                              ← этот каталог
└── .github/workflows/deploy.yml
```

**Чего пока нет:** `data/defaults/*.json` (константы живут в `sim/constants.ts` и в дефолтах
блоков), `tests/golden/`, `scripts/`. Задания каталога остаются TypeScript-модулями (решение **D3**);
YAML появился в фазе 4 только как авторский вход для пользовательских заданий —
`src/engine/authoring/` разбирает и проверяет его в рантайме.

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
  | { id: number; kind: 'simulate'; scheme: SchemeV1; scenario: string; sampleCount: number }
  | { id: number; kind: 'ceiling'; scheme: SchemeV1; scenario: string }
  | { id: number; kind: 'accept'; ref: ChallengeRef; scheme: SchemeV1; attempt: number; hintsUsed: number[] };

type WorkerResponse = { id: number; payload?: SimResult | CeilingResult | ChallengeVerdict | null; error?: string };
```

Каждый запрос несёт номер `id`; ответ находит свой отложенный промис по нему. Устаревшие ответы
дополнительно отбрасываются в сторах по номеру запроса, поэтому доехавший поздний результат не
перетирает свежий.

**Отмена.** Новый расчёт схемы снимает предыдущий: его промис отклоняется меткой `superseded`,
воркер убивается `terminate()` (иначе он досчитывал бы заведомо ненужное — сообщения он читает
только между задачами), на его место создаётся свежий, а чужие запросы из очереди — например,
идущая приёмка задания — переносятся на него без потери. Метка `superseded` отличается от ошибки:
на ней запрос не пересчитывается синхронно в главном потоке, в отличие от отказа воркера.

### 5.2. Инкрементальность

Хэш подграфа (структура + параметры) кэширует результат шагов 2–4. При правке одного параметра
пересчитывается только затронутый узел и всё, что ниже по потоку; Monte-Carlo пересчитывается
целиком, но с уменьшенным N в режиме preview.

### 5.3. Capacity sweep

Бинарный поиск множителя трафика (`sim/ceiling.ts`, `docs/02-simulation.md` §4.1): удвоение вверх
до первого насыщения, затем 12 делений отрезка пополам — до 30 прогонов решателя без Monte-Carlo,
7 мс на демо-схеме «Видеоплатформа». Возвращает предельный RPS, множитель к текущему трафику,
узел-ограничитель и его `boundBy`.

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
группы — `groups.json`, параметры — `params.json`, роли узлов поставляемых схем — `nodes.json`,
справка по блокам — `help.json`, подсказки к параметрам — `hints.json`, остальное (интерфейс,
находки, вердикты приёмки, задания) — `common.json`. Продакшн-языки: **ru, en**.

Первые пять неймспейсов бандлятся в `i18n.ts` при старте. `help` и `hints` — исключение: они
весят около 400 КБ на язык и догружаются `import()`-ом через `services/referenceBundle.ts` в момент,
когда открыли справку или выделили блок в инспекторе (ADR-15). Поэтому `useSuspense` выключен:
namespace может появиться после первого рендера.

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
install → lint → typecheck → test → build → deploy (GitHub Pages)
```

Шага `compile-challenges` нет и не будет: задания каталога — TypeScript-модули, а авторский YAML
разбирается в браузере, а не при сборке.

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
| `Dialog`, `ErrorBoundary`, `Icon` | те же, `DspIcons` → `SdIcons` (99 родовых иконок, без вендорских логотипов, ADR-10) | почти как есть |
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
| Слот модели у блока | `types/component.ts` | `ComponentModel` = `serviceSec` + `capacity` (+ опционально `autoscale`, `cost`, `storage`, `availability`, `quorum`, `cache`). Заполнен у всех блоков MVP, несущих трафик |
| Декларативные ограничители | `sim/resources.ts` | `littleLaw`, `explicitRps`, `connectionBound`, `iopsBound`, `vendorUnitBound`, `bandwidthBound`, `partitionBound`, `quotaBound`, `memoryResidencyBound`. Каждый отдаёт `Explain` с формулой и подставленными значениями, поэтому `boundBy` всегда объясним |
| Расчёт вне UI | `workers/simulation.worker.ts`, `services/simulationService.ts` | Web Worker с отменой устаревших расчётов (§5.1) и отбрасыванием поздних ответов; в Node и при отказе воркера — синхронный fallback через динамический импорт |
| Метрики на канвасе | `SdNode`, `TrafficEdge` | Полоса утилизации с цветом по порогу, RPS, переведённое имя ограничителя; толщина жилы по RPS, красный отлив при ρ > 0.8, подписи в X-ray |
| Панель результатов | `panels/Dashboard` | Итоги, потоки с квантилями, находки с переходом на узел, аномалии согласованности, мультирегион с RPO/RTO |
| Демо-схемы | `data/demoSchemes.ts` | «Видеоплатформа» и «Платежи в двух регионах» — они же приёмочный тест фазы |
| Готовые схемы в шапке | `data/sampleSchemes.ts` | Один список для комбобокса: группа «Демо-схемы» и по группе на задание с его эталонными решениями (48 схем). Имя загруженной схемы — «задание · решение» |
| Имена узлов | `utils/nodeName.ts`, `locales/*/nodes.json` | Подпись пользователя → роль узла по его id → имя типа блока. Роли лежат в словаре локалей, а не в схеме, поэтому переключение языка переименовывает узлы эталонов на лету |

Известное ограничение визуализации: формула толщины из
[03-connections.md](03-connections.md) §5.1 — `w = clamp(1 + 1.6·log10(rps), 1, 8)` — насыщается
при `rps ≳ 24k`, поэтому на схемах масштаба «Видеоплатформы» почти все жилы получают максимальную
толщину. Формула оставлена абсолютной намеренно: только так легенда «толщина ↔ RPS» осмысленна и
сравнима между схемами.

### 12.2. Что добавила фаза 2

| Появилось | Где | Суть |
|---|---|---|
| Контракт задания | `engine/challenges/types.ts` | `Challenge` = брифинг, требования-предикаты, батарея сценариев, рубрика, подсказки с ценой, эталонные решения. Задания — TypeScript-модули (решение **D3**), а не данные |
| Движок приёмки | `engine/challenges/{predicates,realism,lint,rubric,accept}.ts` | 13 видов предикатов, Realism Gate против «схем-обманок», линтер положительных правил и антипаттернов, рубрика по 7 осям, звёзды, вердикт с трассировкой до конкретного требования |
| Каталог заданий | `data/challenges/` | Один модуль на задачу, стартовая схема собирается `services/schemeBuilder.ts` |
| Приёмка вне UI | `workers/simulation.worker.ts` (запрос `accept`), `store/challengeStore.ts` | Прогон батареи сценариев в том же воркере, что и расчёт схемы; прогресс и потраченные подсказки в `localStorage` |
| Панель заданий | `components/panels/Challenges` | Требования в реальном времени, отчёт со звёздами, эталонные решения после сдачи |

### 12.3. Что добавила фаза 3

| Появилось | Где | Суть |
|---|---|---|
| Волны V1 и V2 каталога | `engine/components/*` | 44 → 127 блоков в 14 группах — весь запланированный каталог; модель ёмкости у 101 блока, несущего трафик; 99 родовых иконок |
| Ход времени | `sim/transient.ts` | Прогон по шагам: лаг автоскейлера, очереди с памятью между шагами, прогрев кэша; ряд `timeline` в `SimResult`, 16 сценариев (10 transient) |
| Группы `vpc` и `k8s-cluster` | `engine/components/topology.ts`, `sim/{compile,findings}.ts` | Межсетевой хоп и выход через NAT в задержке, стоимость control plane, находки `k8s-pods-exceeded` и `nat-saturated` |
| Показания проб | `sim/probes.ts` | 11 измерителей считают значение, единицу, статус и `explain`; расчёт схемы от них не меняется — пробы вырезаются из топологии |
| Окна измерителей и водопад | `canvas/ProbeWindows.tsx`, `common/Waterfall`, `utils/waterfall.ts` | Показание на самом блоке пробы, окно по двойному клику, водопад задержки в дашборде и в окне `probe-waterfall`; раскладка вынесена в чистую функцию и покрыта тестом |
| Таймлайн | `panels/Dashboard/Timeline.tsx` | Ряды transient-прогона: нагрузка, утилизация, p99, backlog, ошибки, инстансы; полосы нарушения SLO |
| Туториал | `components/tutorial/` | 8 шагов на живой схеме; шаги — чистый редьюсер `tutorialSteps.ts`, поэтому проверяются тестом без DOM |
| Шаринг и экспорт | `services/{shareLink,imageExport,reportExport}.ts` | Схема в ссылке, PNG канваса, Markdown-отчёт по результату расчёта |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `services/serviceWorker.ts` | Установка и офлайн-запуск статики |

### 12.4. Что добавила версия 1.3.2

| Появилось | Где | Суть |
|---|---|---|
| Справка по блоку (FR-PAL-3) | `components/dialogs/BlockHelpDialog.tsx`, `locales/{ru,en}/help.json` | Окно на 127 блоков: назначение, ограничители ёмкости полосами, практики, типичные ошибки, таблица параметров, порты, переходы к соседям по группе. Открывается из палитры, инспектора и контекстного меню узла; ключ — `helpId` блока |
| Подсказки к параметрам (FR-PRM-5) | `panels/Inspector`, `hooks/useParamHelp.ts`, `locales/{ru,en}/hints.json` | 666 подсказок на язык: смысл параметра, единица измерения, рабочий диапазон. Единица стоит у поля всегда; текст приходит по наведению на имя параметра, а тумблер «Описания параметров» раскрывает его под каждым полем сразу. Тумблер выключен по умолчанию — иначе панель втрое длиннее — и помнится между сессиями |
| Ленивые словари справки | `services/referenceBundle.ts`, `hooks/useReference.ts` | `help` и `hints` грузятся `import()`-ом по требованию и добавляются в i18next как namespace — четыре отдельных чанка сборки (378 + 260 КБ русских, 256 + 168 КБ английских) в главный бандл не попадают (ADR-15) |
| Ёмкость блока на дефолтах | `utils/blockReference.ts` | `NodeContext` на параметрах по умолчанию при 5000 rps и смеси 80/20; полосы в справке считает сама модель блока, поэтому разойтись с движком они не могут |
| Подпись связи | `store/graphStore.ts`, `services/schemeSerializer.ts`, `canvas/TrafficEdge.tsx` | Поле `label` у ребра: правится в инспекторе, рисуется на холсте, сохраняется в схему только непустым |

### 12.5. Что осталось на следующие фазы

* Аномалии A3/A7/A8 и сценарий `split-brain` — см. [02-simulation.md](02-simulation.md) §15.3,
  там же полный перечень нереализованного.
* Зеркальные регионы `mirrorOf` (ADR-13): регионы пока описываются явно.
* Инкрементальный пересчёт по хэшу подграфа; сейчас схема считается целиком.
* Волна V2 каталога — 20 блоков из [01-components.md](01-components.md) §15.
* `custom`-предикат и структурный дифф с эталонным решением — [04-challenges.md](04-challenges.md) §11.3.
* Лидерборды (нужен бэкенд), LLM-ревьюер и импорт задания по ссылке из недоверенного источника.
* Графическая часть проб: `probe-rps` без тайм-серии, `probe-latency` без гистограммы,
  `probe-heatmap` без оверлея на схеме — сейчас эти измерители отдают число, а не картинку.

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
| ADR-8 | Задания каталога — TypeScript-модули; YAML оставлен авторскому режиму и разбирается в рантайме своим парсером подмножества | Типизация ловит опечатку в задании на компиляции, а сборочный шаг YAML→JSON не нужен. Для авторского входа (FR-CHL-9) YAML всё же нужен — человеку писать задание в JSON неудобно; парсер свой, около 300 строк, чтобы не тянуть полноценный YAML в бандл ради одного экрана |
| ADR-9 | Константы и цены — версионируемые датасеты с `asOf` | Устаревание неизбежно; должно быть видимым и PR-friendly |
| ADR-10 | Никаких вендорских логотипов-ассетов | Юридический риск; свой набор иконок в стиле `DspIcons` |
| ADR-11 | **Мультирегион входит в MVP** (решение D1) | Без него не существует заданий уровня 5, а гео-маршрутизация и межрегиональный лаг — физическая основа модели аномалий. Цена по UI гасится «зеркальными регионами»: регион описывается один раз и инстанцируется N раз |
| ADR-12 | **Согласованность — настройка, по умолчанию симуляция аномалий** (решение D2) | Аналитический расчёт аномалий стоит O(V+E) — единицы миллисекунд, поэтому «дорого» здесь про авторство контента, а не про рантайм. Режимы `выкл`/`атрибут` оставлены для простых заданий и для профиля «Обучение»; задание может зафиксировать режим, иначе задачи про платежи сдаются отключением модели |
| ADR-13 | Регионы-зеркала — не копия узлов, а ссылка `mirrorOf` | Иначе схема на 3 региона утраивает граф, ломает undo/redo и делает правку невыносимой. Зеркало разворачивается в полный граф только внутри движка |
| ADR-15 | Справка по блоку и подсказки к параметрам — ленивые словари локали, а не поля `ComponentDefinition` | Текстов много: 127 блоков × (описание, ёмкость, практики, ошибки) и 666 параметров, по два языка — 639 КБ на русском и 425 КБ на английском (177 и 146 КБ в gzip). В `initComponents` они попали бы в главный бандл и грузились бы на каждый старт ради экрана, который открывают по кнопке. `locales/{ru,en}/{help,hints}.json` подключаются через `import()` в `referenceBundle.ts` и добавляются в i18next как namespace в рантайме. Ядро остаётся без текстов, а блок и его справка связаны только полем `helpId` — тест `blockReference` требует запись на обоих языках для каждого блока и каждого параметра и запрещает висячие ключи. Ёмкость в справке не хранится текстом, а считается моделью блока на дефолтных параметрах — расходиться с движком ей нечем |
| ADR-14 | Роль узла поставляемой схемы — не поле схемы, а запись в локали по его id | `SchemeNode.label` — подпись пользователя, и запекать в неё «Горячие ссылки» значит выбрать язык в момент сборки схемы и потерять перевод при переключении языка. Имена ролей лежат в `locales/{ru,en}/nodes.json` и подставляются при отрисовке, схема остаётся языконезависимой, а ссылка-шаринг открывается на языке получателя. Цена — id узлов в схемах каталога становятся частью контракта: тест требует имя на обоих языках для каждого узла и запрещает висячие ключи |
