# 01. Каталог строительных блоков

Приложение к [PRD.md](../PRD.md). Исчерпывающий перечень типов компонентов, их параметров и
производных метрик.

**Обозначения:**
* **M** — блок входит в первую волну (MVP, фаза 1).
* **V1** — волна v1.0, зарегистрирована в фазе 3. **V2** — волна v2.0, зарегистрирована в фазе 4.
  Обе в реестре: каталог покрыт целиком.
* *Ограничитель* — какой ресурс, как правило, связывает ёмкость этого блока первым.

---

## 0. Универсальное ядро параметров

Каждый блок — это «обслуживающий прибор с ёмкостью». Различаются они тем, **какой ресурс упирается
первым** и **какие производные метрики** они дают (хранилище, память, egress). Поэтому у всех блоков
есть общий набор параметров, а специфика добавляется сверху.

Определение блока, помимо параметров, несёт флаг `managed`. Он стоит у блоков, чью избыточность
держит провайдер и у которых нет счётчика инстансов: `cdn`, `dns`, `glb`, `s3`, `dynamodb`, `sqs`,
`serverless`. Такой блок не считается единой точкой отказа, не штрафуется за низкую утилизацию
и не участвует в оценке запаса прочности.

### 0.1. Общие параметры (есть у всех блоков)

| Секция | Параметр | Ед. | Смысл |
|---|---|---|---|
| **Масштаб** | `instances` | шт | Число экземпляров/подов/нод в пуле |
| | `autoscale.enabled` | bool | Включён ли автоскейлинг |
| | `autoscale.min` / `.max` | шт | Границы |
| | `autoscale.targetUtilization` | 0–1 | Целевая ρ (типично 0.6–0.7) |
| | `autoscale.scaleUpLagSec` | с | Лаг реакции (важен для transient-сценариев; типично 30–180) |
| | `azSpread` | шт | По скольким AZ размазан пул |
| **Производительность** | `serviceTimeMs` | мс | Чистое время обслуживания одного запроса (p50), без ожидания |
| | `serviceTimeSigma` | — | σ логнормального распределения времени обслуживания (0.3 — стабильно, 1.2 — «толстый хвост») |
| | `concurrencyPerInstance` | шт | Одновременно обслуживаемых запросов (воркеры/потоки/event-loop-слоты) |
| **Ёмкость** | `maxRpsPerInstance` | rps | Явный вендорский потолок (если применимо) |
| | `maxConnections` | шт | Лимит соединений на инстанс |
| | `cpuCores`, `memoryGb` | — | Ресурсы инстанса (или выбранный пресет типа `c6i.4xlarge`) |
| | `networkMbps` | Мбит/с | Пропускная способность сетевого интерфейса |
| **Поведение** | `timeoutMs` | мс | Таймаут на обслуживание |
| | `queueLimit` | шт | Глубина очереди перед сбросом (0 = без очереди, сразу 503) |
| | `loadBalancing` | enum | `round-robin` / `least-conn` / `random-2-choices` / `hash` |
| | `callMode` | enum | `sequential` / `parallel` — как блок вызывает свои зависимости (влияет на latency-свёртку) |
| **Надёжность** | `availability` | % | Доступность одного экземпляра (по умолчанию 99.9%) |
| | `mttrSec` | с | Время восстановления/failover |
| | `healthCheck` | bool | Выведение больных инстансов из ротации |
| **Стоимость** | `costPerInstanceHour` | $ | Compute |
| | `costPerGbMonth` | $ | Storage |
| | `costPerGbEgress` | $ | Исходящий трафик |
| | `costPerMillionRequests` | $ | Пооперационная тарификация |

### 0.2. Производные метрики (считает движок, есть у всех блоков)

| Метрика | Формула / источник |
|---|---|
| `λ_in` | Входящий RPS (суммарно и в разрезе Flow и read/write) |
| `capacity` | `min(concurrency/S, instances·maxRps, connections/connPerReq, iops/iopsPerReq, netMbps/payload, …)` |
| `boundBy` | Имя ресурса, который дал минимум — **главная обучающая метрика** |
| `ρ` | `λ_in / capacity` |
| `W_q` | Ожидание в очереди, аппроксимация G/G/c |
| `latency` | p50/p95/p99 обслуживания (сервис + ожидание) |
| `errorRate` | Доля сброшенных/затаймаутившихся запросов при ρ→1 |
| `queueDepth` | Средняя длина очереди (закон Литтла) |
| `storageGb` / `growthGbDay` | Для блоков с состоянием |
| `memoryUsedGb` | Рабочий набор / кэш |
| `networkMbps` | in/out |
| `costMonth` | $ по всем статьям |
| `availabilityEffective` | С учётом резервирования |
| `anomalies` | Частота аномалий согласованности по типам (при включённом режиме симуляции аномалий) |

### 0.3. Параметры согласованности и средства смягчения

Активны, когда настройка **«Модель согласованности» = «симуляция аномалий»** (значение по умолчанию).
В режиме «атрибут» эти параметры остаются, но используются только предикатами заданий; в режиме
«выкл» — скрыты.

**У хранилищ (`sql`, `nosql`, `cache`, `search`, `olap`):**

| Параметр | Значения | Роль в модели |
|---|---|---|
| `consistencyModel` | `linearizable` / `sequential` / `bounded-staleness` / `read-your-writes` / `monotonic` / `eventual` | Верхняя граница гарантий, которую блок вообще способен дать |
| `replicationMode` | `sync` / `semi-sync` / `async` | Определяет распределение лага |
| `replicaLagMs` | мс, задаётся явно; дефолты по блокам — в таблице ниже | Медиана логнормального лага — основной вход расчёта устаревших чтений |
| `replicaLagSigma` | 0.1–3.0, шаг 0.1; **по умолчанию 0.8** у всех блоков | σ того же логнормального распределения. Медиана задаёт «типичный» лаг, σ — длину хвоста; именно из хвоста берётся частота устаревших чтений и RPO |
| `quorum` | `N`, `R`, `W` | При `R + W > N` устаревшие чтения исчезают (без учёта отказов) |
| `concurrencyControl` | `none` / `optimistic` (CAS, версии) / `pessimistic` (блокировки) / `crdt` | Определяет вероятность потерянных обновлений |
| `conflictResolution` | `lww` / `vector-clock` / `crdt` / `single-writer-per-key` / `manual` | Что происходит при конфликте мульти-мастера |
| `transactionScope` | `none` / `single-row` / `single-shard` / `cross-shard` / `distributed-2pc` | Стоимость и хрупкость транзакций |
| `isolationLevel` | `read-uncommitted` … `serializable` | Для SQL: какие аномалии в принципе возможны |

**Лаг репликации: дефолты по блокам первой волны.** Пара `replicaLagMs` + `replicaLagSigma` есть
у девяти блоков MVP — у всех, где в модели вообще есть реплики:

| Блок | `replicaLagMs` | Реалистичный диапазон медианы | Допустимо | `replicaLagSigma` |
|---|---|---|---|---|
| `postgres` | 200 мс | 50–2000 мс | 0–600 000 мс | 0.8 |
| `mysql` | 500 мс | 50–2000 мс | 0–600 000 мс | 0.8 |
| `mongodb` | 100 мс | 20–2000 мс | 0–600 000 мс | 0.8 |
| `cassandra` | 30 мс | 5–500 мс | 0–600 000 мс | 0.8 |
| `dynamodb` | 20 мс | 5–500 мс | 0–600 000 мс | 0.8 |
| `elasticsearch` | 1000 мс | 200–30 000 мс | 0–600 000 мс | 0.8 |
| `clickhouse` | 500 мс | 100–10 000 мс | 0–600 000 мс | 0.8 |
| `redis` | 5 мс | 1–100 мс | 0–60 000 мс | 0.8 |
| `local-cache` | 1000 мс | — (рассогласование копий в процессах) | 0–600 000 мс | 0.8 |

У `replicaLagSigma` во всех девяти блоках один диапазон: 0.1–3.0 с шагом 0.1, значение по
умолчанию 0.8. Лаг разыгрывается как `L ~ LogNormal(median = replicaLagMs, σ = replicaLagSigma)`,
и из этого распределения движок берёт две величины:

```
E[L]   = median · e^(σ²/2)         при σ = 0.8 → 1.38 × медианы  → частота устаревших чтений
p99(L) = median · e^(2.3263 · σ)   при σ = 0.8 → 6.43 × медианы  → RPO мультирегиона
```

То есть для `postgres` с дефолтами: средний лаг ≈ 276 мс, p99 ≈ 1.29 с, и именно 1.29 с станет
расчётным RPO при потере региона. Медиана дополнительно растёт с утилизацией источника
(`median_eff = median · (1 + ρ²/(1 − ρ))`) — перегруженный primary реплицируется хуже.

**У рёбер (профилей вызова):**

| Параметр | Значения | Роль в модели |
|---|---|---|
| `readRouting` | `primary` / `replica` / `nearest` / `sticky-after-write` | Доля чтений, способных увидеть устаревшие данные |
| `readYourWrites` | `none` / `sticky-primary` / `version-token` / `wait-for-lag` | Средство смягчения; каждое имеет свою цену в latency |
| `idempotencyKey` | bool | Убирает аномалию «дубликат обработки» при ретраях и at-least-once |
| `deliverySemantics` | `at-most-once` / `at-least-once` / `effectively-once` | Для async-рёбер |
| `orderingGuarantee` | `none` / `per-key` / `per-partition` / `global` | Аномалия «нарушение порядка» |
| `staleToleranceMs` | число | Сколько устаревания допустимо для этого вызова — порог, ниже которого аномалия не считается ошибкой |

**У Flow:**

| Параметр | Роль |
|---|---|
| `readAfterWriteShare` | Доля запросов, читающих только что записанное (главный множитель аномалии read-your-writes) |
| `readAfterWriteDelayMs` | Распределение задержки между записью и последующим чтением |
| `sameKeyConcurrency` | Насколько часто разные пользователи пишут один ключ (вход для потерянных обновлений и конфликтов) |
| `consistencyRequirement` | Какие аномалии для этого сценария недопустимы (проверяется предикатами заданий) |

Формулы — в [02-simulation.md](02-simulation.md), §7а.

---

## 1. Клиенты и источники трафика (`clients`)

Источник любого RPS в схеме. Не имеют входов (аналог `generators` в dsp-flow).

| ID | Название | Волна | Специфичные параметры |
|---|---|---|---|
| `client-web` | Веб-клиенты (браузер) | **M** | `dau`, `sessionsPerUserDay`, `requestsPerSession`, `sessionDurationMin`, `peakFactor`, `diurnalPattern` (flat/business/evening/global), `readWriteMix`, `avgRequestKb`, `avgResponseKb`, `geoDistribution`, `growthPerYear`, `cacheableShare` |
| `client-mobile` | Мобильные клиенты | **M** | то же + `pollIntervalSec`, `offlineSyncBurst`, `pushEnabled`, `networkRtt` (3G/4G/5G/Wi-Fi) |
| `client-iot` | IoT/устройства | V1 | `deviceCount`, `reportIntervalSec`, `payloadBytes`, `batchSize`, `alwaysConnected` |
| `client-api` | Внешние API-потребители (партнёры) | V1 | `clients`, `rpsPerClient`, `quota`, `burstiness` (c_a²), `authMode` |
| `client-bot` | Боты/скраперы/поисковые краулеры | V1 | `rps`, `respectRobots`, `cacheBusting` (доля запросов, обходящих кэш) |
| `client-loadtest` | Нагрузочный генератор | V1 | `pattern` (constant/ramp/spike/sawtooth), `targetRps`, `durationSec` — для transient-сценариев |
| `client-internal` | Внутренний потребитель (другая команда/сервис) | V1 | `rps`, `slaTier` |

**Двусторонний пересчёт (FR-PRM-7):** `rps_avg = dau × requestsPerUserDay / 86400`,
`rps_peak = rps_avg × peakFactor`. Пользователь может править любую сторону.
`peakFactor` по умолчанию 3.0 (типичный суточный профиль); при `diurnalPattern = evening` — 4–5.

---

## 2. Периметр и сеть (`edge`)

| ID | Название | Волна | Специфичные параметры | Ограничитель |
|---|---|---|---|---|
| `dns` | DNS / GeoDNS | **M** | `ttlSec`, `routingPolicy` (simple/latency/geo/weighted/failover), `healthCheckSec`, `resolveMs`, `geoMapping` (гео-профиль → регион) | — (обычно не узкое место, но TTL напрямую задаёт время переключения регионов, то есть RTO) |
| `cdn` | CDN (CloudFront / Cloudflare / Akamai / Fastly) | **M** | `popCount`, `cacheHitRatio` (авто из TTL и Zipf-профиля контента / manual), `ttlSec`, `originShield`, `edgeLatencyMs` (10–30), `originLatencyMs`, `maxObjectSizeMb`, `costPerGbEgress` (по регионам), `costPerMillionRequests`, `signedUrls`, `rangeRequests` | Egress-стоимость, не RPS |
| `waf` | WAF / anti-DDoS | V1 | `rulesCount`, `inspectionMs`, `falsePositiveRate`, `rateLimitRps`, `botScore` | CPU |
| `glb` | Global LB / Anycast | **M** | `regions`, `routingPolicy` (latency/geo/weighted/failover), `failoverSec`, `healthCheckIntervalSec`, `stickyRegion` (нужен для read-your-writes), `drainOnFailover` | — |
| `lb-l4` | L4 балансировщик (NLB / HAProxy TCP / IPVS) | **M** | `maxConnections`, `newConnPerSec`, `throughputGbps`, `algorithm`, `stickiness`, `latencyMs` (~0.2–0.5) | Соединения / пропускная способность |
| `lb-l7` | L7 балансировщик / реверс-прокси (ALB, nginx, Envoy, Traefik, HAProxy) | **M** | `maxRps`, `tlsTerminate`, `tlsHandshakeMs`, `keepAlive`, `http2`, `compression`, `latencyMs` (~1), `healthCheck`, `retryPolicy`, `connectionDrainSec` | CPU (особенно TLS) / RPS |
| `api-gateway` | API Gateway (Kong / AWS API GW / Envoy Gateway / Apigee) | **M** | `authMode` (none/JWT-local/introspection), `authLatencyMs`, `rateLimitRpsPerClient`, `quotaPerDay`, `requestTransform`, `responseCacheEnabled` + `cacheTtl`, `maxRps`, `costPerMillionRequests`, `payloadLimitMb` | CPU / вендорский лимит RPS |
| `rate-limiter` | Rate limiter / throttle | V1 | `algorithm` (token-bucket / leaky-bucket / sliding-window / GCRA), `limitRps`, `burst`, `scope` (global/per-user/per-ip/per-key), `backingStore` (local/redis), `rejectMode` (429 / queue / shed) | Backing store |
| `reverse-cache` | Кэширующий прокси (Varnish / nginx cache) | V1 | `cacheSizeGb`, `hitRatioMode` + `hitRatioOverride`, `ttlSec`, `staleWhileRevalidate`, `varyHeaders`, `purgeApi` | Память / диск |
| `ws-gateway` | WebSocket / push-шлюз | V1 | `concurrentConnections`, `connectionsPerInstance` (типично 50k–200k), `memoryPerConnKb`, `messagesPerConnMin`, `messageBytes`, `heartbeatSec`, `fanoutMode` (direct / pub-sub) | **Соединения и память, а не RPS** |
| `service-mesh` | Sidecar-прокси (Istio / Linkerd) | V1 | `latencyOverheadMs` (0.5–2), `cpuOverheadPercent`, `mtls`, `retryPolicy`, `circuitBreaker`, `observabilityExport` | Оверхед CPU на каждом хопе |
| `nat-egress` | NAT / egress-шлюз | V2 | `throughputGbps`, `portsPerIp`, `costPerGb` | Порты / пропускная способность |

> **Обучающий акцент:** `ws-gateway` и `cdn` специально смоделированы так, чтобы упираться **не в RPS**:
> первый — в число соединений и память, второй — в стоимость egress. Это лечит главную ошибку новичка
> «всё меряется в RPS».

### 2.0. Целые значения остаются целыми

Числовой параметр объявляет `step`, если дробное значение осмысленно: `readWriteMix` ходит по 0.01,
`cpuCores` у подовых блоков — по 0.25 (это `500m` из Kubernetes). Параметр **без** объявленного
шага — счётный: инстансы, шарды, брокеры, партиции, реплики. Инспектор это соблюдает: ползунок
такого параметра выдаёт только целые, стрелки поля шагают на единицу, а введённое руками `3.5`
округляется до `4` при записи в схему. Дробных инстансов в схеме не бывает.

### 2.1. Сколько единиц у блока

Блок, за который платят почасово, обязан говорить, **сколько его**: без этого счёт нельзя ни
посчитать, ни уменьшить. Имя счётчика зависит от природы блока — `instances` у пулов, `nodes` у
кластеров, `brokers` у брокеров, `workers` у Trino, `regionServers` у HBase, `replicaSetSize` ×
`shardCount` у MongoDB, `cores` у батча, `1 + readReplicas` у Aurora и Timescale. Проверяется это
тестом `tests/engine/instance-count.test.ts`: у каждого блока с почасовой ценой есть счётчик, и
увеличение счётчика увеличивает счёт.

Счётчика нет там, где считать нечего: клиентские блоки, управляемые сервисы с оплатой за запросы и
объём (`s3`, `dynamodb`, `sqs`, `bigquery`, `glb`, наблюдаемость), а также `sqlite` и `local-cache`,
которые по определению живут в одном экземпляре.

Обратное тоже проверяется: у блока с `instances` рост числа инстансов **обязан** поднимать ёмкость —
кроме четырёх случаев, где потолок физически не в инстансах, и это видно по имени ограничителя:

| Блок | Ограничитель | Почему инстансы не помогают |
|---|---|---|
| `rate-limiter` | `counter-store` | Счётчики живут в общем Redis: его `maxOpsPerSec` и есть потолок (при `backingStore = local` ёмкость растёт с инстансами) |
| `stream-processor` | `partitions` | Параллелизм упирается в число партиций источника |
| `dist-lock` | `lock-serialization` | Замок сериализует держателей, сколько бы узлов ни стояло |
| `saga-orchestrator` | `state-transitions` | Потолок — переходы в хранилище состояния |

---

## 3. Вычисления и сервисы (`compute`)

Серверные блоки группы (`service`, `monolith`, `bff`, `serverless`, `ml-inference`,
`edge-function`, `webrtc-sfu`) держат два входных порта: `in` для синхронного вызова и `consume`
для событий брокера. У `worker`, `batch`, `stream-processor`, `transcoder` и `search-indexer`
вход только консьюмерский — сами они запросов не обслуживают. Протоколы и матрицу совместимости
описывает `docs/03-connections.md` §4.

| ID | Название | Волна | Специфичные параметры | Ограничитель |
|---|---|---|---|---|
| `service` | Stateless-сервис / микросервис | **M** | `runtime` (JVM/Go/Node/Python/.NET — влияет на дефолты concurrency и cold start), `concurrencyPerInstance`, `serviceTimeMs`, `serviceTimeSigma`, `cpuShare` (доля CPU-времени в service time), `cpuCores`, `networkMbps`, `callMode`, `logLinesPerRequest`, `logBytesPerLine` | CPU / воркеры |
| `monolith` | Монолит | **M** | то же + `moduleCount`, `sharedDbConnections`, `startupSec` | CPU, затем пул соединений к БД |
| `bff` | BFF / агрегатор | V1 | `downstreamCalls` (авто из рёбер), `callMode: parallel`, `aggregationMs`, `partialFailureMode` (fail-fast / degrade) | Хвост параллельных вызовов |
| `serverless` | Serverless-функция (Lambda / Cloud Run) | **M** | `memoryMb`, `coldStartMs`, `coldStartShare` (доля вызовов, попавших в холодный старт), `maxConcurrency`, `costPerGbSecond`, `costPerMillionInvocations`, `maxDurationSec`, `provisionedConcurrency` | Лимит конкурентности аккаунта |
| `worker` | Фоновый воркер / консьюмер | **M** | `concurrency`, `processingTimeMs`, `cpuShare`, `cpuCores`, `prefetch`, `batchSize`, `retries`, `dlqEnabled`, `idempotent` | CPU, затем воркеры (`instances × concurrency × batchSize`) |
| `cron` | Планировщик / cron | V1 | `scheduleCron`, `jobDurationSec`, `overlapPolicy`, `spikeFactor` (пик от единовременного запуска) | Всплеск в момент запуска |
| `batch` | Батч-обработка (Spark / Airflow-джоба) | V1 | `datasetGb`, `throughputMbPerCoreSec`, `cores`, `windowHours`, `shuffleFactor` | ЦПУ × окно |
| `stream-processor` | Стрим-процессор (Flink / Kafka Streams / Spark Streaming) | V1 | `parallelism`, `recordsPerSecPerTask`, `stateSizeGb`, `checkpointIntervalSec`, `windowType`, `exactlyOnce`, `watermarkLagSec` | Параллелизм = число партиций |
| `transcoder` | Медиа-транскодер | V1 | `renditions[]` (профили качества), `speedFactor` (× реального времени, CPU 0.3–2, GPU 4–20), `codec` (H.264/H.265/AV1), `hardwareAccel`, `costPerInstanceHour`, `queuePriority` | ЦПУ/ГПУ-часы |
| `ml-inference` | ML-инференс / эмбеддинги | V1 | `modelSizeGb`, `batchSize`, `inferenceMs`, `gpuType`, `throughputPerGpu`, `warmupSec`, `quantized` | GPU |
| `search-indexer` | Индексатор | V1 | `docsPerSec`, `docSizeKb`, `indexLagSec`, `refreshIntervalSec` | Пропускная способность индексации |
| `webrtc-sfu` | Медиасервер / SFU | V2 | `participantsPerRoom`, `bitrateKbps`, `simulcastLayers`, `cpuPerStream`, `egressGbps` | Пропускная способность и CPU |
| `edge-function` | Edge-compute (Cloudflare Workers) | V2 | `cpuMsLimit`, `popCount`, `costPerMillionRequests` | CPU-ms |

### Доля CPU в времени обслуживания (`cpuShare`)

`serviceTimeMs` — это всё время обслуживания запроса, включая ожидание диска, БД и соседних
сервисов. На процессоре из него проводится только часть, и задаёт её `cpuShare`. Именно этот
параметр отделяет I/O-bound сервис от CPU-bound: ёмкость по процессору считается по CPU-времени,
а не по полному времени обслуживания.

```
S            = serviceTimeMs / 1000                    # полное время обслуживания, с
capacity_cpu = instances × cpuCores / (S × cpuShare)   # ёмкость по процессору, запр./с
capacity_wrk = instances × concurrencyPerInstance / S  # ёмкость по воркерам, запр./с
```

| Блок | Дефолт | Реалистичный диапазон | Допустимо | `S` по умолчанию | CPU-время | `capacity_cpu` на дефолтах |
|---|---|---|---|---|---|---|
| `service` | 0.15 | 0.05–0.5 | 0.01–1.0, шаг 0.01 | 20 мс | 3 мс | 4000 запр./с (3 инстанса × 4 ядра) |
| `monolith` | 0.25 | 0.1–0.6 | 0.01–1.0, шаг 0.01 | 45 мс | 11.25 мс | 2844 запр./с (4 инстанса × 8 ядер) |
| `worker` | 0.5 | 0.2–1.0 | 0.01–1.0, шаг 0.01 | 120 мс | 60 мс | 133 сообщ./с (4 инстанса × 2 ядра) |

Проверка на дефолтах `service`: воркеры дают `3 × 200 / 0.02 = 30 000 запр./с`, процессор —
`3 × 4 / 0.003 = 4000 запр./с`, сеть — `3 × 1000 Мбит/с / 8 / 22 КБ = 17 045 запр./с`
(при 2 КБ запроса и 20 КБ ответа). Минимум даёт процессор, поэтому `boundBy = cpu`. Поставьте
`cpuShare = 0.02` — сервис, который почти всё время ждёт БД, — и ограничителем станут воркеры:
тот же блок, другой урок.

У `worker` в формулу входит `batchSize`: ёмкость считается по времени обработки целой пачки
(`processingTimeMs`), а время обслуживания одного сообщения — `processingTimeMs / batchSize`.

### Доля холодных стартов (`coldStartShare`)

У `serverless` время обслуживания складывается из «горячего» времени и амортизированного
холодного старта:

```
S = (serviceTimeMs + coldStartMs × coldStartShare) / 1000
```

| Параметр | Дефолт | Реалистичный диапазон | Допустимо |
|---|---|---|---|
| `coldStartMs` | 400 мс | — | 0–10 000 мс |
| `coldStartShare` | 0.02 (2% вызовов) | 0–0.1 | 0–1.0, шаг 0.01 |

С дефолтами `S = 80 мс + 400 мс × 0.02 = 88 мс` против 80 мс «горячих» — холодные старты
добавляют 10% к времени обслуживания и, через него, к p50/p95/p99 всего потока. Ограничитель
`concurrency` при этом считается по горячему времени, без надбавки за холодный старт:
`maxConcurrency / (serviceTimeMs / 1000) = 1000 / 0.08 = 12 500 запр./с`.

**Автоматически выводимое для `service`:** объём логов (`λ × logLinesPerRequest × logBytesPerLine × 86400`),
метрик и трейсов — уходит в блоки группы `observability` (см. §12) и в статью стоимости.

---

## 4. Реляционные БД (`sql`)

| ID | Название | Волна | Специфика |
|---|---|---|---|
| `postgres` | PostgreSQL | **M** | движок MVCC, autovacuum, connection-bound |
| `mysql` | MySQL / MariaDB | **M** | InnoDB, buffer pool |
| `aurora` | Amazon Aurora (PG/MySQL) | V1 | распределённый storage, до 15 read-реплик, лаг < 100 мс |
| `vitess` | Vitess / шардированный MySQL | V1 | явные шарды и vtgate |
| `cockroach` | CockroachDB | V1 | распределённые транзакции, Raft, гео-партиционирование |
| `yugabyte` | YugabyteDB | V2 | то же |
| `spanner` | Google Spanner | V2 | внешняя консистентность, TrueTime, дорогой |
| `sqlite` | SQLite / встроенная | V2 | для edge-сценариев |

### Параметры реляционной БД

| Секция | Параметр | Комментарий |
|---|---|---|
| Топология | `role` | `primary` / `read-replica` / `standby` |
| | `readReplicas` | Число реплик чтения |
| | `replicationMode` | `async` / `semi-sync` / `sync` — влияет на latency записи и на RPO |
| | `replicaLagMs` | Медиана лага: 200 мс у `postgres`, 500 мс у `mysql`; реалистично 50–2000 мс. Эффективная медиана растёт с утилизацией primary |
| | `replicaLagSigma` | σ логнормального лага, по умолчанию 0.8 (диапазон 0.1–3.0, шаг 0.1). Задаёт хвост: p99 лага = медиана × 6.43, и это же значение становится RPO (§0.3) |
| | `sharding.enabled`, `.shardCount`, `.shardKey`, `.strategy` | `hash` / `range` / `directory` |
| | `failoverSec` | 15–120 с; попадает в расчёт доступности |
| Ёмкость | `instanceClass` | Пресет (vCPU/RAM/сеть) |
| | `maxConnections` | 200 у `postgres`, 500 у `mysql`; реалистично 100–1000 |
| | `connectionPooler` | `none` / `pgbouncer-transaction` / `pgbouncer-session` / `proxy-managed` — умножает потолок соединений на 1 / 10 / 2 / 5 |
| | `storageGb`, `storageType` | gp3 / io2 / local NVMe |
| | `provisionedIops`, `iopsPerRead`, `iopsPerWrite` | Запись обычно 3–8 IOPS (WAL + страницы + индексы) |
| | `bufferPoolGb` | Кэш страниц; влияет на долю попаданий в память |
| Данные | `rowSizeBytes`, `rowCount`, `indexCount`, `indexOverhead` (0.2–1.0×) | Для проекции хранилища |
| | `workingSetGb` | Активный набор; если > `bufferPoolGb` — растёт доля дисковых чтений |
| | `retentionDays`, `compressionRatio` | |
| Запросы | `queryProfile` | `point-read` (0.2–1 мс) / `range-scan` / `join` / `aggregate` / `full-scan` |
| | `readServiceMs`, `writeServiceMs` | Дефолты от профиля; ×5–20 при промахе мимо buffer pool |
| | `transactionsPerWrite`, `lockContention` | Для сценария hot-row |
| Консистентность | `isolationLevel`, `readYourWrites`, `readFromReplica` (доля чтений с реплик), `stickyReadShare` (доля чтений, закреплённых за одной репликой) | Предикаты заданий проверяют это |
| Надёжность | `backupSchedule`, `pitrDays`, `multiAz` | Хранилище бэкапов идёт в стоимость |

**Что из этой таблицы считает движок.** У `postgres` и `mysql` задан 31 параметр. В расчёт идут
`readReplicas`, `shardCount`, `maxConnections`, `connectionPooler`, `connectionsPerQuery`,
`cpuCores`, `provisionedIops`, `iopsPerRead` / `iopsPerWrite`, `readServiceMs` / `writeServiceMs`,
`rowSizeBytes`, `rowCount`, `indexOverhead`, `readFromReplica`, `stickyReadShare`,
`replicationMode`, `consistencyModel`, `replicaLagMs` / `replicaLagSigma`, `isolationLevel`
(таблица аномалий изоляции, `docs/02-simulation.md` §7а.2), `concurrencyControl`, `failoverSec`,
`multiAz` (признак наличия реплик, когда репликация не нарисована ребром: с ним синхронная запись
платит RTT между AZ), `availability` и обе статьи стоимости. С 1.7 `provisionedIops` не только
ограничивает ёмкость, но и оплачивается по ставке профиля цен сверх бесплатных 3000 IOPS
(`docs/02-simulation.md` §9). Параметры `bufferPoolGb`,
`workingSetGb`, `queryProfile`, `storageGb` пока только хранятся;
`conflictResolution` у самого блока не читается — конфликты мульти-мастера разрешаются значением
из `multi-region-policy` (§13.1). Строки `role`, `instanceClass`, `sharding.*`, `storageType`,
`indexCount`, `transactionsPerWrite`, `lockContention`, `backupSchedule`, `pitrDays`,
`retentionDays`, `compressionRatio` волна V1 в блок не добавила, а `readYourWrites` задаётся
не на блоке, а на ребре (§0.3).

**Модель ёмкости `postgres` и `mysql` (так считает движок):**
```
S           = (readShare × readServiceMs + writeShare × writeServiceMs) / 1000
cpu         = cpuCores × shardCount × (1 + readReplicas × readFromReplica) / S
connections = maxConnections × shardCount × poolerFactor / connectionsPerQuery / S
iops        = provisionedIops × shardCount / (readShare × iopsPerRead + writeShare × iopsPerWrite)
capacity    = min(cpu, connections, iops)

poolerFactor:  none 1 · pgbouncer-session 2 · proxy-managed 5 · pgbouncer-transaction 10
```
На дефолтах `postgres` при смеси 80% чтения / 20% записи: `S = 1.14 мс`, `cpu = 11 228 запр./с`,
`connections = 175 439 запр./с`, `iops = 7500 запр./с` — `boundBy = iops`, и всё упирается в
дорогую запись (`iopsPerWrite = 4` против `iopsPerRead = 1`).

Классическое «Postgres упёрся в соединения» появляется, когда
`maxConnections × poolerFactor / connectionsPerQuery` опускается ниже
`cpuCores × shardCount × (1 + readReplicas × readFromReplica)` — на дефолтах это 12.8, то есть
нужно либо урезать `maxConnections`, либо поднять `connectionsPerQuery` (транзакция из нескольких
запросов). Пулер двигает ту же границу в обратную сторону, умножая потолок соединений на 2–10×.

---

## 5. NoSQL и специализированные хранилища (`nosql`)

| ID | Название | Волна | Ключевые специфичные параметры | Ограничитель |
|---|---|---|---|---|
| `mongodb` | MongoDB | **M** | `replicaSetSize`, `shardCount`, `shardKey`, `writeConcern` (w:1/majority), `readPreference`, `documentSizeKb`, `indexCount`, `workingSetGb`, `wiredTigerCacheGb` | Память рабочего набора |
| `cassandra` | Cassandra | **M** | `nodes`, `replicationFactor`, `consistencyLevel` (ONE/QUORUM/ALL), `partitionKey`, `partitionSizeMb`, `compactionStrategy` (STCS/LCS/TWCS), `writeAmplification`, `tombstones`, `hintedHandoff` | Диск и compaction, запись дешёвая |
| `scylla` | ScyllaDB | V1 | то же + `shardsPerCore`, `throughputMultiplier` (≈3–5× vs Cassandra) | CPU-shard |
| `dynamodb` | DynamoDB | **M** | `capacityMode` (provisioned/on-demand), `rcu`, `wcu`, `itemSizeKb`, `partitionKey`, `hotPartitionRisk`, `gsiCount` (каждый GSI = ещё WCU), `ttlEnabled`, `streams`, `costPerMillionRW` | RCU/WCU и **горячая партиция (3000 RCU / 1000 WCU на партицию)** |
| `hbase` | HBase | V2 | `regionServers`, `regionsPerServer`, `hdfsReplication` | Регионы |
| `couchbase` | Couchbase | V2 | `bucketCount`, `memoryQuotaGb`, `ejectionPolicy` | Память |
| `redis-store` | Redis как основное хранилище | V1 | `persistence` (none/RDB/AOF), `durabilityRisk`, `memoryGb`, `evictionPolicy: noeviction` | Память и durability |
| `neo4j` | Neo4j / графовая БД | V1 | `nodeCount`, `edgeCount`, `traversalDepth`, `cacheGb`, `queryComplexity` | Память / глубина обхода |
| `timescale` | TimescaleDB | V1 | `metricsPerSec`, `chunkIntervalHours`, `compressionAfterDays`, `retentionDays` | Запись и сжатие |
| `influx` | InfluxDB | V1 | `instances`, `seriesCardinality`, `pointsPerSec`, `retentionPolicy` | **Кардинальность** |
| `prometheus` | Prometheus / VictoriaMetrics | V1 | `activeSeries`, `scrapeIntervalSec`, `samplesPerSec`, `bytesPerSample` (~1.7 сжатых), `retentionDays` | Кардинальность и память |
| `etcd` | etcd / ZooKeeper / Consul (KV, координация) | V1 | `nodes` (нечётное), `writeQuorumMs`, `maxDbSizeMb`, `watchers`, `leaseCount` | Кворум записи, **не масштабируется записью** |
| `s3-table` | Iceberg / Delta Lake поверх объектного хранилища | V2 | `fileSizeMb`, `partitioning`, `compaction`, `manifestOverhead` | Метаданные и compaction |

У всех трёх блоков MVP этой группы есть полный набор параметров согласованности из §0.3, включая
`replicaLagMs` + `replicaLagSigma`: `mongodb` — 100 мс, `cassandra` — 30 мс, `dynamodb` — 20 мс,
σ = 0.8 у всех трёх.

---

## 6. Поиск и векторы (`search`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `elasticsearch` | Elasticsearch / OpenSearch | **M** | `nodes`, `shardsPerIndex`, `replicas`, `docCount`, `docSizeKb`, `indexSizeGb` (обычно 1.1–2× сырых данных), `refreshIntervalSec` (влияет на «свежесть» и на throughput), `queryType` (term/match/aggregation), `heapGb`, `fieldDataCache` | Heap и число шардов |
| `meilisearch` | Meilisearch / Typesense | V1 | `docCount`, `indexRamGb`, `queryMs`, `typoTolerance` | Память |
| `solr` | Apache Solr | V2 | `shards`, `replicas`, `softCommitMs` | — |
| `vector-db` | Векторная БД (Pinecone / Milvus / Qdrant / pgvector) | V1 | `vectorCount`, `dimensions`, `indexType` (HNSW/IVF), `memoryPerVectorBytes` (`dim × 4 × 1.5`), `recallTarget`, `queryMs`, `topK` | Память (вектора живут в RAM) |
| `autocomplete` | Сервис автодополнения (Trie/FST) | V1 | `prefixCount`, `memoryGb`, `queryMs`, `updateLagMin` | Память |

У `elasticsearch` «свежесть» задают два независимых параметра: `refreshIntervalSec` (1 с по
умолчанию — когда документ становится видимым в индексе) и лаг реплик `replicaLagMs = 1000 мс`
при `replicaLagSigma = 0.8` — именно второй идёт в расчёт устаревших чтений (§0.3).

---

## 7. Аналитика и OLAP (`olap`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `clickhouse` | ClickHouse | **M** | `nodes`, `shards`, `replicas`, `rowsIngestedPerSec`, `rowSizeBytes`, `compressionRatio` (5–15×), `columnsScannedPerQuery`, `partsPerPartition`, `mergeThroughputMbs`, `queryConcurrency`, `materializedViews`, `ttlDays` | Дисковый скан и merge |
| `bigquery` | BigQuery | V1 | `bytesScannedPerQuery`, `queriesPerDay`, `slotCount`, `costPerTbScanned`, `partitioning`, `clustering` | **$ за просканированные ТБ** |
| `snowflake` | Snowflake | V1 | `warehouseSize`, `creditsPerHour`, `autoSuspendMin`, `concurrentQueries` | Кредиты |
| `redshift` | Redshift | V2 | `nodes`, `nodeType`, `distKey`, `sortKey`, `vacuumNeeded` | Диск/сеть |
| `druid` | Apache Druid | V2 | `segments`, `realtimeIngestRps`, `rollupRatio` | Реалтайм-ингест |
| `trino` | Trino / Presto | V1 | `workers`, `bytesScanned`, `pushdown` | Скан |
| `lakehouse` | Data Lake (S3 + каталог) | V1 | `rawGbPerDay`, `format` (parquet/orc), `compression`, `partitionScheme`, `lifecycleDays` | Стоимость хранения |

У `clickhouse` реплики асинхронные: `replicaLagMs = 500 мс`, `replicaLagSigma = 0.8` (§0.3), а
`concurrencyControl = none` — то есть блок штатно даёт и устаревшие чтения, и потерянные
обновления, если писать в один ключ из нескольких мест.

---

## 8. Кэши (`cache`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `redis` | Redis (standalone / sentinel / cluster) | **M** | `mode`, `shards`, `replicasPerShard`, `memoryGb`, `evictionPolicy` (LRU/LFU/TTL/noeviction), `ttlSec`, `keySizeBytes`, `valueSizeBytes`, `overheadPerKeyBytes` (~50–100), `uniqueKeys`, `zipfAlpha`, `maxOpsPerSec` (на шард, ~80–150k; ×2 при `pipelining`), `maxConnections`, `persistence`, `clusterHashSlots`, `hotKeyShare` | Операции шарда → затем память |
| `memcached` | Memcached | V1 | `memoryGb`, `slabSize`, `threads`, `maxOpsPerSec` | Память |
| `local-cache` | In-process кэш (Caffeine / LRU) | **M** | `sizeMb`, `maxEntries`, `ttlSec`, `perInstance: true`, `coherenceRisk` (рассогласование между инстансами!), `uniqueKeys`, `zipfAlpha`, `stampedeProtection`, `refreshAhead` | Память процесса, консистентность |
| `hazelcast` | Распределённый in-memory grid | V2 | `nodes`, `backupCount`, `nearCache` | Память + сеть |
| `cdn-cache` | Кэш CDN | — | см. `cdn` в §2 | Egress |

### Политики кэширования (параметр `strategy` у ребра «сервис → кэш»)

| Значение | Поведение в модели |
|---|---|
| `cache-aside` (lazy) | Промах → чтение из БД → запись в кэш. Трафик в БД = `λ_read × (1 − hitRatio)`; при холодном старте hitRatio = 0 |
| `read-through` | То же, но промах обслуживает сам кэш-слой |
| `write-through` | Каждая запись идёт и в кэш, и в БД: +latency записи, hitRatio выше |
| `write-behind` | Запись в кэш, асинхронный флаш в БД: быстрая запись, риск потери, буфер |
| `write-around` | Запись минует кэш: меньше засорения, ниже hitRatio на свежих данных |
| `refresh-ahead` | Проактивное обновление до истечения TTL: меньше промахов, лишний трафик в БД |

### Пространство ключей и скос популярности (`uniqueKeys`, `zipfAlpha`)

**Hit ratio по умолчанию не задаётся, а выводится** — из размера пространства ключей, скоса
популярности, объёма памяти, TTL и доли записи (формулы — [02-simulation.md](02-simulation.md), §6).
Поэтому главные параметры кэша — `uniqueKeys` и `zipfAlpha`, а не «hit ratio».

| Параметр | `redis` | `local-cache` | Допустимо | Реалистичный диапазон |
|---|---|---|---|---|
| `uniqueKeys` | 10 000 000 | 1 000 000 | 1–10¹² | — |
| `zipfAlpha` | 1.0 | 1.0 | 0.3–2.5, шаг 0.1 | 0.6–1.4 |

Пресеты α: `0.6` — почти равномерное обращение (кэшируется плохо), `1.0` — типичный веб,
`1.3` — соцсеть и новости, `2.0` — сильно скошенный поток (тренды, звёзды).

```
entryBytes    = keySizeBytes + valueSizeBytes + overheadPerKeyBytes   # local-cache: +64 Б всегда
capacityBytes = shards × memoryGb × 0.75                              # redis: 75% памяти под данные
                min(sizeMb, maxEntries × entryBytes)                  # local-cache
M             = capacityBytes / entryBytes                            # сколько ключей влезло
t_reaccess    = min(M, N) / λ_read                                    # интервал повторного обращения
ttlFactor     = 1 − e^(−ttlSec / t_reaccess)                          # 1, если ttlSec = 0
h             = H(M, α) / H(N, α) × (1 − writeShare) × ttlFactor      # N = uniqueKeys
H(n, α)       = Σ_{k=1..n} k^(−α)
```

На дефолтах `local-cache`: `entryBytes = 40 + 512 + 64 = 616 Б`, ёмкость
`min(256 МБ, 100 000 записей × 616 Б) = 61.6 МБ` → влезает 100 000 ключей из 1 000 000, базовый
`h = H(10⁵, 1) / H(10⁶, 1) ≈ 0.84`. Дальше его срезают запись и TTL: при 800 чтениях/с интервал
повторного обращения — 125 с, при `ttlSec = 60 с` это даёт `ttlFactor = 0.38`, и с 20% записи
итоговый hit ratio выходит 0.26.

На дефолтах `redis` картина обратная: `entryBytes = 40 + 1024 + 64 = 1128 Б`, ёмкость
`3 шарда × 26 ГБ × 0.75 = 58.5 ГБ` → влезает 51.9 млн ключей при `uniqueKeys = 10 млн`, то есть
всё пространство ключей помещается целиком и `H(M, α) / H(N, α) = 1`. Дальше всё решает TTL: при
`ttlSec = 300 с` и 1000 чтений/с интервал повторного обращения к ключу — 10 000 с, ключ протухает
задолго до него, и hit ratio падает до 3%. Кэш размером с базу не помогает, если TTL короче
интервала повторного обращения — это и есть тот урок, который не виден, когда hit ratio вбивают руками.

**Режим и override.** У каждого блока с моделью кэша (`redis`, `memcached`, `local-cache`,
`hazelcast`, `reverse-cache`) есть пара параметров:

| Параметр | Значения | Что делает |
|---|---|---|
| `hitRatioMode` | `auto` / `manual` | Откуда берётся hit ratio: из модели или из объявленного числа |
| `hitRatioOverride` | 0–1 | Число, которое используется в режиме `manual` |

По умолчанию узлы-кэши стоят в `auto` (считает модель), а `reverse-cache` — в `manual`. В обоих
режимах показанное число и поглощение трафика — одно и то же: что видно в панели, то и снимается с
нижестоящих блоков. Ручной режим годится, когда доля попаданий известна из наблюдений; авто — когда
её надо получить из схемы. Сброс кэша (сценарий `cache-flush`) обнуляет оба режима одинаково.

У `reverse-cache` до версии 1.5.1 было **два** параметра доли попаданий: `cacheHitRatio` поглощал
трафик, `hitRatioOverride` показывался в панели, и крутить можно было не тот. Остался один —
`hitRatioOverride`; он же оценивает, какая доля запросов заполняет кэш и занимает память.

У блоков, где кэш — свойство самого блока, а не отдельный узел, модели ключей нет и режим не
заведён: `cdn.cacheHitRatio` (0.92 по умолчанию) и `dns.resolverCacheHitRatio` (0.9) остаются
ручными числами.

---

## 9. Очереди, брокеры, стриминг (`messaging`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `kafka` | Apache Kafka | **M** | `brokers`, `topics`, `partitions`, `replicationFactor`, `minInsync`, `acks` (0/1/all), `messageSizeKb`, `retentionHours`, `compression`, `batchMs`, `consumerGroups`, `consumersPerGroup`, `diskGb`, `throughputMbsPerBroker` (~100–500), `produceLatencyMs`, `orderingScope: partition` | **Партиции (потолок параллелизма консьюмеров)** и диск под retention |
| `rabbitmq` | RabbitMQ | **M** | `nodes`, `queues`, `quorumQueues`, `prefetch`, `ackMode`, `messageSizeKb`, `maxQueueDepth`, `lazyQueues`, `throughputPerQueue` (~20–50k/с), `dlqEnabled`, `ttl`, `priorityLevels` | Пропускная способность одной очереди |
| `sqs` | AWS SQS | **M** | `type` (standard/FIFO), `visibilityTimeoutSec`, `maxReceiveCount`, `dlq`, `batchSize`, `costPerMillionRequests`, `fifoThroughputLimit` (3000/с с batching) | Лимит FIFO, стоимость запросов |
| `sns` | SNS / Pub-Sub fanout | V1 | `subscribers`, `fanout`, `filterPolicy`, `deliveryRetries` | Fanout-множитель |
| `nats` | NATS / NATS JetStream | V1 | `subjects`, `maxAckPending`, `streamRetention`, `throughput` | — |
| `pulsar` | Apache Pulsar | V2 | `partitions`, `tieredStorage`, `subscriptionType` | — |
| `kinesis` | AWS Kinesis | V1 | `shards`, `mbPerShardIn` (1 МБ/с), `recordsPerShard` (1000/с), `retentionHours`, `enhancedFanout` | Жёсткий лимит шарда |
| `redis-streams` | Redis Streams | V1 | `maxLen`, `consumerGroups`, `pendingLimit` | Память |
| `outbox` | Transactional Outbox | V1 | `pollIntervalMs`, `batchSize`, `backlogRows`, `publishLagMs` | Лаг публикации |
| `cdc` | CDC / Debezium | V1 | `sourceDb`, `changesPerSec`, `snapshotMode`, `lagMs`, `walRetention` | Лаг WAL |
| `dlq` | Dead Letter Queue | **M** | `maxRetries`, `alertThreshold`, `reprocessMode` | — |
| `scheduler-queue` | Отложенные задачи / delayed queue | V1 | `delayDistribution`, `maxDelayHours`, `pendingJobs` | Хранилище отложенных |

**Производные метрики очередей:** `consumerLagMessages`, `lagSeconds = backlog / consumerThroughput`,
`timeToDrain`, `backlogGb`. Если `producerRps > consumerThroughput` — лаг растёт линейно, и симулятор
показывает время до заполнения retention (после чего — потеря данных). Это один из самых наглядных
уроков режима «Задания».

---

## 10. Объектные, файловые и блочные хранилища (`storage`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `s3` | Amazon S3 / GCS / Azure Blob | **M** | `objectCount`, `avgObjectSizeMb`, `putRps`, `getRps`, `storageClass` (standard/IA/glacier), `costPerGbMonth`, `costPerMillionPut`, `costPerMillionGet`, `costPerGbEgress`, `multipartThresholdMb`, `versioning`, `lifecycleDays`, `crossRegionReplication`, `firstByteLatencyMs` (20–60), `throughputPerPrefixMbs`, `durability` (11 девяток) | Стоимость egress; RPS на префикс (5500 GET / 3500 PUT) |
| `minio` | MinIO (self-hosted S3) | **M** | `nodes`, `disksPerNode`, `erasureCoding` (EC:4+2 → overhead 1.5×), `usableTb`, `throughputGbps`, `costPerTbMonth` (железо) | Диски и сеть |
| `glacier` | Холодное хранилище / архив | V1 | `retrievalTier` (expedited/standard/bulk), `retrievalHours`, `costPerGbMonth`, `costPerGbRetrieval`, `minStorageDays` | Время и стоимость извлечения |
| `nfs` | Сетевая ФС (EFS / NFS) | V1 | `throughputMbs`, `iops`, `burstCredits`, `costPerGbMonth` | Пропускная способность |
| `block` | Блочное устройство (EBS / локальный NVMe) | V1 | `sizeGb`, `type` (gp3/io2/nvme), `iops`, `throughputMbs`, `latencyUs` (100–500) | IOPS |
| `hdfs` | HDFS | V2 | `nodes`, `blockSizeMb`, `replication` (3), `namenodeMemoryGb` | Метаданные namenode |
| `ftp-legacy` | Legacy файловый сервер | V2 | `instances`, `throughputMbs`, `concurrency` | — |

---

## 11. Платформенные сервисы (`platform`)

| ID | Название | Волна | Ключевые параметры |
|---|---|---|---|
| `auth` | Auth / IdP (Keycloak, Auth0, Cognito) | **M** | `mode` (JWT-local-verify / introspection / session-lookup), `verifyMs` (0.05 локально vs 3–10 по сети), `tokenTtlSec`, `sessionStore`, `loginRps`, `jwksCacheSec`, `mfaShare` |
| `session-store` | Хранилище сессий | V1 | `backend` (redis/db/cookie-jwt), `sessionSizeKb`, `activeSessions`, `ttlMin` |
| `config` | Конфиг / feature flags | V1 | `pollIntervalSec`, `pushMode`, `clientCache`, `evaluationsPerRequest` |
| `discovery` | Service discovery (Consul / etcd / K8s DNS) | V1 | `services`, `instances`, `refreshSec`, `dnsTtl` |
| `secrets` | Secrets manager (Vault / KMS) | V1 | `requestsPerSec`, `cacheTtlSec`, `encryptionMs`, `costPerRequest` |
| `dist-lock` | Распределённая блокировка | V1 | `backend` (redis/etcd/zk), `lockHoldMs`, `contentionRate`, `fencingTokens` — **источник сериализации, часто скрытое узкое место** |
| `id-gen` | Генератор ID (Snowflake / UUIDv7 / ticket-server) | V1 | `strategy`, `idsPerSec`, `clockSkewRisk`, `monotonic` |
| `notification` | Сервис уведомлений (push/email/SMS) | V1 | `channels[]`, `fanoutPerEvent`, `providerRateLimit`, `costPerMessage`, `retryPolicy`, `deliveryLagSec` |
| `webhook` | Диспетчер вебхуков | V1 | `subscribers`, `deliveryTimeoutMs`, `retryBackoff`, `concurrency`, `slowConsumerShare` |
| `payment-external` | Внешний платёжный шлюз | V1 | `p50Ms`/`p99Ms` (200/3000), `rateLimitRps`, `availability` (99.9%), `costPerTransaction`, `idempotencyRequired`, `webhookCallback` |
| `external-api` | Произвольная внешняя зависимость | **M** | `p50Ms`, `p99Ms`, `rateLimitRps`, `quotaPerDay`, `availability`, `costPerCall`, `timeoutMs`, `circuitBreaker` |
| `email-smtp` | Почтовый шлюз | V2 | `messagesPerSec`, `costPerThousand`, `bounceRate` |
| `saga-orchestrator` | Оркестратор саг / workflow (Temporal, Step Functions) | V1 | `workflowsPerSec`, `stepsPerWorkflow`, `stateStore`, `historyRetentionDays`, `costPerStateTransition` |
| `geo-index` | Гео-индекс (geohash / S2 / H3) | V1 | `precision`, `cellCount`, `updatesPerSec`, `queryRadiusKm`, `backend` |

---

## 12. Наблюдаемость (`observability`)

Отвечает за требование PRD «показать объём памяти, занимаемый логами». Эти блоки **потребляют**
производные потоки от всех остальных блоков.

| ID | Название | Волна | Ключевые параметры | Что считает |
|---|---|---|---|---|
| `logs` | Логи (Loki / ELK / SigNoz / CloudWatch) | **M** | `ingestGbDay` (авто), `retentionDays`, `compressionRatio` (5–10×), `indexedFields`, `samplingRate`, `costPerGbIngest`, `costPerGbMonth`, `queryConcurrency` | `Σ(λ_i × linesPerReq_i × bytesPerLine_i) × 86400` |
| `metrics` | Метрики (Prometheus / VM / Datadog) | **M** | `activeSeries` (авто от числа блоков и меток), `scrapeIntervalSec`, `bytesPerSample` (1.7–2), `retentionDays`, `costPerThousandSeries` | `series × (86400/scrape) × bytes` |
| `traces` | Трейсинг (Jaeger / Tempo) | V1 | `samplingRate`, `spansPerRequest` (= глубина вызова), `spanBytes` (~500–1500), `retentionDays`, `tailSampling` | `λ × sampling × spans × bytes` |
| `apm` | APM / коммерческий observability | V1 | `hostsMonitored`, `costPerHostMonth`, `customMetrics`, `logIngestGb` | Стоимость |
| `alerting` | Алертинг / on-call | V2 | `rules`, `evaluationIntervalSec`, `noiseRatio` | — |
| `audit-log` | Аудит-лог (compliance) | V1 | `eventsPerSec`, `retentionYears`, `immutable`, `costPerGbMonth` | Долгое хранение |

> **Типичный «вау-момент» тренажёра:** сервис на 50k RPS с 10 строками лога по 400 байт даёт
> `50 000 × 10 × 400 × 86400 = 17.3 ТБ/сут` сырых логов — дороже, чем сам сервис. Симулятор показывает
> это в статье стоимости и предлагает семплирование.

---

## 13. Топология и зоны (`topology`)

Не «блоки» в обычном смысле — контейнеры и связи, задающие латентность и домены отказа.

| ID | Название | Волна | Параметры |
|---|---|---|---|
| `region` | Регион | **M** | `code` (`us-east-1`, `eu-west-1`, `ap-southeast-1`…), `geo`, `availability`, `dataResidency` (none/GDPR/local-only), `isPrimary`, `mirrorOf` (id региона-шаблона), `costMultiplier` (регионы стоят по-разному) |
| `az` | Availability Zone | **M** | `id`, `intraAzLatencyMs` (0.25), `failureProbability` |
| `vpc` | VPC / подсеть | V1 | `cidr` (`10.0.0.0/16`), `natRequired`, `natGatewayCount` (1), `natThroughputGbps` (45 — потолок одного NAT-шлюза), `costPerGbProcessed` ($0.045 за ГБ через NAT), `peeringLatencyMs` (0.1), `flowLogsEnabled` |
| `k8s-cluster` | Kubernetes-кластер | V1 | `nodes` (6), `nodeType` (`general` / `compute` / `memory` / `gpu`), `podsPerNode` (110), `schedulingLagSec` (30), `nodeCostPerHour` ($0.15), `controlPlaneCostMonth` ($73), `autoscaleNodes` |
| `link-cross-az` | Межзональный линк | **M** | `latencyMs` (0.5–2), `costPerGb` ($0.01–0.02), `bandwidthGbps` |
| `link-cross-region` | Межрегиональный линк | **M** | `latencyMs` (авто по географии: 10–180), `costPerGb` ($0.02), `bandwidthGbps`, `encryption`, `dedicatedLink` (Direct Connect / Interconnect → ниже цена, выше стабильность) |
| `internet` | Публичный интернет | **M** | `clientRttMs` (по гео-профилю), `packetLoss`, `tlsHandshakeRtt` (1–2 RTT) |
| `multi-region-policy` | Политика мультирегиона | **M** | см. таблицу ниже |

### 13.1. Параметры `multi-region-policy`

| Параметр | Значения | Что определяет в модели |
|---|---|---|
| `mode` | `single` / `active-passive` / `active-active` / `read-local-write-global` / `sharded-by-geo` | Куда попадают чтения и записи, откуда берутся аномалии |
| `writeRegion` | id региона (для `read-local-write-global`) | Все записи едут в один регион → +RTT к latency записи, но нет конфликтов |
| `replicationDirection` | `one-way` / `bidirectional` | Двусторонняя — источник конфликтов записи |
| `replicationLagMs` | авто из `link-cross-region` и объёма | Главный вход модели аномалий |
| `conflictResolution` | `lww` (last-write-wins) / `vector-clock` / `crdt` / `single-writer-per-key` / `manual` | Определяет, теряются ли данные при конфликте |
| `failoverMode` | `manual` / `auto` | Влияет на RTO |
| `rpoTargetSec` / `rtoTargetSec` | целевые значения | Сравниваются с расчётными; расхождение — Finding |
| `dataResidency` | `none` / `strict` | Запрет на выезд данных за пределы региона — предикат заданий уровня 5 |
| `failbackPolicy` | `auto` / `manual` | Поведение после восстановления региона |

**Расчётные величины:** `rpoActual = replicationLagP99` (сколько данных теряется при потере региона),
`rtoActual = detectionSec + dnsTtlSec + failoverSec + warmupSec` (TTL DNS часто оказывается
доминирующим слагаемым — неочевидный и очень полезный урок).

---

## 14. Измерители и пробы (`probes`)

Прямой аналог группы `visualization` в dsp-flow: перетаскиваются на схему и открывают окно.

| ID | Название | Волна | Что показывает |
|---|---|---|---|
| `probe-rps` | RPS-метр | **M** | Тайм-серия входящего/исходящего RPS в точке, разбивка read/write и по Flow |
| `probe-latency` | Гистограмма latency | **M** | Распределение и p50/p95/p99 в точке |
| `probe-utilization` | Датчик утилизации | **M** | ρ и `boundBy` с историей |
| `probe-queue` | Глубина очереди / лаг | **M** | Backlog, lag в секундах, время до дренажа |
| `probe-storage` | Проекция хранилища | **M** | ГБ/сут и прогноз на 1/3/5 лет |
| `probe-cost` | Счётчик стоимости | **M** | $/мес по статьям в поддереве |
| `probe-slo` | SLO-индикатор | **M** | Соответствие цели p99 / доступности, error budget |
| `probe-availability` | Индикатор доступности | V1 | Девятки по пути, вклад каждого компонента |
| `probe-traffic-inspector` | Инспектор трафика | V1 | Полная разбивка запросов, проходящих через точку |
| `probe-heatmap` | Тепловая карта | V1 | Оверлей утилизации на всю схему |
| `probe-waterfall` | Водопад по хопам | V1 | Раскладка latency Flow по компонентам |

---

## 15. Сводка по объёму

| Группа | Блоков | Из них M / V1 / V2 |
|---|---|---|
| clients | 7 | 2 / 5 / 0 |
| edge | 12 | 6 / 5 / 1 |
| compute | 13 | 4 / 7 / 2 |
| sql | 8 | 2 / 3 / 3 |
| nosql | 13 | 3 / 7 / 3 |
| search | 5 | 1 / 3 / 1 |
| olap | 7 | 1 / 4 / 2 |
| cache | 4 | 2 / 1 / 1 |
| messaging | 12 | 4 / 7 / 1 |
| storage | 7 | 2 / 3 / 2 |
| platform | 14 | 2 / 11 / 1 |
| observability | 6 | 2 / 3 / 1 |
| topology | 8 | 6 / 2 / 0 |
| probes | 11 | 7 / 4 / 0 |
| **Итого** | **127** | **44 / 65 / 18** |

Все 127 типов зарегистрированы в `ComponentRegistry`: MVP-волна пришла из фазы 1, V1 — из фазы 3,
V2 — из фазы 4. Каталог покрыт целиком, расхождения между документом и реестром больше нет.
Модель ёмкости заполнена у 101 блока — у всех, кто несёт трафик; у клиентов её нет по построению
(они источники нагрузки), у контейнеров, линков, политик и проб не бывает.

Значения по группам, итог и порядок групп сверяет `tests/engine/catalog.test.ts` — он и есть
источник истины. Прежняя редакция этой таблицы содержала две ошибки, найденные при сверке:
в `platform` стояло 15 при четырнадцати строках в §11, а в `cache` пятой строкой был посчитан
`cdn-cache` — но это не блок, а перекрёстная ссылка на `cdn` из §2 (волна `—`, собственных
параметров нет). Отсюда и прежний неверный итог 129.

Прирост первой волны с 39 до 44 блоков — следствие решения **D1** (мультирегион в MVP):
в неё добавлены `region`, `link-cross-region`, `multi-region-policy`, `dns` и `glb`.

Порядок отображения групп в палитре повторяет порядок этого документа — он же порядок
регистрации в `ComponentRegistry` (как `registry.registerGroup(...)` в `initPlugins.ts` у dsp-flow).

---

## 16. Справка по блоку в интерфейсе

Каталог из 127 типов и 666 различных параметров бесполезен, если игрок не понимает, чем `scylla`
отличается от `cassandra` и что делает `zipfAlpha`. Поэтому у каждого блока есть окно справки, а у
каждого параметра — подсказка с единицей измерения.

Поиск в палитре с двух символов ищет не только по имени и идентификатору блока, но и по тексту
«что это и когда ставить» из справки: «очередь» находит блоки, у которых очередь в описании, а не
в названии.

**Где открывается:** кнопка `?` на карточке блока в палитре, кнопка `?` в шапке инспектора у
выбранного блока, пункт «Справка о блоке» в контекстном меню узла на холсте и клавиша `F1`
(или `?`) при одном выделенном узле. Закрывается по `Esc`.

**Что внутри окна:**

| Раздел | Содержание |
|---|---|
| Шапка | Иконка, имя блока, группа, волна (`MVP` / `V1` / `V2`), метка «управляемый сервис» |
| Что это и когда ставить | 2–3 предложения: задача блока и повод добавить его в схему |
| Что ограничивает ёмкость | Текстовое объяснение плюс полосы ограничителей, посчитанные моделью блока на параметрах по умолчанию при нагрузке 5000 rps и смеси 80/20; первый в списке помечен как «упирается первым», у каждого показана формула из `explain` с подставленными значениями |
| Как делать правильно | 3–5 практик с конкретными числами: какие значения параметров осмысленны и с чем блок соединяют |
| Типичные ошибки | 2–4 антипаттерна и то, как они выглядят в симуляции |
| Параметры | Таблица по секциям: имя, ключ, значение по умолчанию с единицей, подсказка и допустимый диапазон |
| Порты | Входы и выходы с протоколами |
| Соседи по группе | Кнопки перехода к справке соседних блоков — сравнение альтернатив в два клика |

Полосы ёмкости считаются той же моделью, что и симуляция (`utils/blockReference.ts` собирает
`NodeContext` на дефолтах и зовёт `definition.model.capacity`), поэтому разойтись с движком они не
могут: меняется модель — меняется и справка.

**Тексты** лежат не в определении блока, а в локали: `locales/{ru,en}/help.json` ключуется
идентификатором блока, `locales/{ru,en}/hints.json` — именем параметра (ADR-15). Оба словаря
догружаются по требованию через `services/referenceBundle.ts` и не попадают в главный бандл.
Подсказки к параметрам общие для всех блоков, где параметр встречается, поэтому пишутся
вендор-нейтрально: `costPerInstanceHour` объясняется одинаково и для `service`, и для `postgres`.

Над параметрами инспектор показывает живые метрики выбранного блока — нагрузку, загрузку ρ, время
ответа, стоимость и строку об ограничителе ёмкости, — а значение, выпавшее из диапазона схемы
параметров, подписывается прямо под полем: за `min`/`max` красным «расчёт будет бессмысленным»,
за рабочим диапазоном `realistic` — «так не бывает».

В инспекторе подсказка живёт в двух видах. По умолчанию панель компактная: подсказка приходит
по наведению на имя параметра — одной всплывающей подписью, где собраны объяснение, рабочий
диапазон и единица. Тумблер **«Описания параметров»** под шапкой блока раскрывает те же тексты
под каждым полем сразу: так удобно читать незнакомый блок целиком, но панель становится в
три-четыре раза длиннее. Состояние тумблера переживает перезагрузку, единица измерения при поле
ввода остаётся всегда.
