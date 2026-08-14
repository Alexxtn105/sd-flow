# 01. Каталог строительных блоков

Приложение к [PRD.md](../PRD.md). Исчерпывающий перечень типов компонентов, их параметров и
производных метрик.

**Обозначения:**
* **M** — блок входит в первую волну (MVP, фаза 1).
* **V1** — фаза 3 (v1.0). **V2** — позже.
* *Ограничитель* — какой ресурс, как правило, связывает ёмкость этого блока первым.

---

## 0. Универсальное ядро параметров

Каждый блок — это «обслуживающий прибор с ёмкостью». Различаются они тем, **какой ресурс упирается
первым** и **какие производные метрики** они дают (хранилище, память, egress). Поэтому у всех блоков
есть общий набор параметров, а специфика добавляется сверху.

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
| `replicaLagMs` | авто (median) + `replicaLagSigma` | Основной вход расчёта устаревших чтений |
| `quorum` | `N`, `R`, `W` | При `R + W > N` устаревшие чтения исчезают (без учёта отказов) |
| `concurrencyControl` | `none` / `optimistic` (CAS, версии) / `pessimistic` (блокировки) / `crdt` | Определяет вероятность потерянных обновлений |
| `conflictResolution` | `lww` / `vector-clock` / `crdt` / `single-writer-per-key` / `manual` | Что происходит при конфликте мульти-мастера |
| `transactionScope` | `none` / `single-row` / `single-shard` / `cross-shard` / `distributed-2pc` | Стоимость и хрупкость транзакций |
| `isolationLevel` | `read-uncommitted` … `serializable` | Для SQL: какие аномалии в принципе возможны |

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
| `reverse-cache` | Кэширующий прокси (Varnish / nginx cache) | V1 | `cacheSizeGb`, `hitRatio` (авто), `ttlSec`, `staleWhileRevalidate`, `varyHeaders`, `purgeApi` | Память / диск |
| `ws-gateway` | WebSocket / push-шлюз | V1 | `concurrentConnections`, `connectionsPerInstance` (типично 50k–200k), `memoryPerConnKb`, `messagesPerConnMin`, `messageBytes`, `heartbeatSec`, `fanoutMode` (direct / pub-sub) | **Соединения и память, а не RPS** |
| `service-mesh` | Sidecar-прокси (Istio / Linkerd) | V1 | `latencyOverheadMs` (0.5–2), `cpuOverheadPercent`, `mtls`, `retryPolicy`, `circuitBreaker`, `observabilityExport` | Оверхед CPU на каждом хопе |
| `nat-egress` | NAT / egress-шлюз | V2 | `throughputGbps`, `portsPerIp`, `costPerGb` | Порты / пропускная способность |

> **Обучающий акцент:** `ws-gateway` и `cdn` специально смоделированы так, чтобы упираться **не в RPS**:
> первый — в число соединений и память, второй — в стоимость egress. Это лечит главную ошибку новичка
> «всё меряется в RPS».

---

## 3. Вычисления и сервисы (`compute`)

| ID | Название | Волна | Специфичные параметры | Ограничитель |
|---|---|---|---|---|
| `service` | Stateless-сервис / микросервис | **M** | `runtime` (JVM/Go/Node/Python/.NET — влияет на дефолты concurrency и cold start), `workers`, `serviceTimeMs`, `cpuBoundShare` (доля CPU-времени в service time), `memoryPerRequestMb`, `startupSec`, `callMode`, `logLinesPerRequest`, `logBytesPerLine` | CPU / воркеры |
| `monolith` | Монолит | **M** | то же + `moduleCount`, `sharedDbConnections`, `deployRiskFactor` (для сценариев) | Соединения к БД |
| `bff` | BFF / агрегатор | V1 | `downstreamCalls` (авто из рёбер), `callMode: parallel`, `aggregationMs`, `partialFailureMode` (fail-fast / degrade) | Хвост параллельных вызовов |
| `serverless` | Serverless-функция (Lambda / Cloud Run) | **M** | `memoryMb`, `coldStartMs`, `coldStartRate` (авто от RPS и `keepWarm`), `maxConcurrency`, `initSec`, `costPerGbSecond`, `costPerMillionInvocations`, `maxDurationSec`, `provisionedConcurrency` | Лимит конкурентности аккаунта |
| `worker` | Фоновый воркер / консьюмер | **M** | `concurrency`, `processingTimeMs`, `prefetch`, `batchSize`, `retryPolicy`, `dlqEnabled`, `idempotent` | Пропускная способность vs лаг очереди |
| `cron` | Планировщик / cron | V1 | `scheduleCron`, `jobDurationSec`, `overlapPolicy`, `spikeFactor` (пик от единовременного запуска) | Всплеск в момент запуска |
| `batch` | Батч-обработка (Spark / Airflow-джоба) | V1 | `datasetGb`, `throughputMbPerCoreSec`, `cores`, `windowHours`, `shuffleFactor` | ЦПУ × окно |
| `stream-processor` | Стрим-процессор (Flink / Kafka Streams / Spark Streaming) | V1 | `parallelism`, `recordsPerSecPerTask`, `stateSizeGb`, `checkpointIntervalSec`, `windowType`, `exactlyOnce`, `watermarkLagSec` | Параллелизм = число партиций |
| `transcoder` | Медиа-транскодер | V1 | `renditions[]` (профили качества), `speedFactor` (× реального времени, CPU 0.3–2, GPU 4–20), `codec` (H.264/H.265/AV1), `hardwareAccel`, `costPerInstanceHour`, `queuePriority` | ЦПУ/ГПУ-часы |
| `ml-inference` | ML-инференс / эмбеддинги | V1 | `modelSizeGb`, `batchSize`, `inferenceMs`, `gpuType`, `throughputPerGpu`, `warmupSec`, `quantized` | GPU |
| `search-indexer` | Индексатор | V1 | `docsPerSec`, `docSizeKb`, `indexLagSec`, `refreshIntervalSec` | Пропускная способность индексации |
| `webrtc-sfu` | Медиасервер / SFU | V2 | `participantsPerRoom`, `bitrateKbps`, `simulcastLayers`, `cpuPerStream`, `egressGbps` | Пропускная способность и CPU |
| `edge-function` | Edge-compute (Cloudflare Workers) | V2 | `cpuMsLimit`, `popCount`, `costPerMillionRequests` | CPU-ms |

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
| | `replicaLagMs` | Производное от режима и нагрузки (async: 50–2000 мс) |
| | `sharding.enabled`, `.shardCount`, `.shardKey`, `.strategy` | `hash` / `range` / `directory` |
| | `failoverSec` | 15–120 с; попадает в расчёт доступности |
| Ёмкость | `instanceClass` | Пресет (vCPU/RAM/сеть) |
| | `maxConnections` | 100–5000; **типичный ограничитель Postgres** |
| | `connectionPooler` | none / pgbouncer(transaction) / RDS Proxy — радикально меняет потолок |
| | `storageGb`, `storageType` | gp3 / io2 / local NVMe |
| | `provisionedIops`, `iopsPerRead`, `iopsPerWrite` | Запись обычно 3–8 IOPS (WAL + страницы + индексы) |
| | `bufferPoolGb` | Кэш страниц; влияет на долю попаданий в память |
| Данные | `rowSizeBytes`, `rowCount`, `indexCount`, `indexOverhead` (0.2–1.0×) | Для проекции хранилища |
| | `workingSetGb` | Активный набор; если > `bufferPoolGb` — растёт доля дисковых чтений |
| | `retentionDays`, `compressionRatio` | |
| Запросы | `queryProfile` | `point-read` (0.2–1 мс) / `range-scan` / `join` / `aggregate` / `full-scan` |
| | `readServiceMs`, `writeServiceMs` | Дефолты от профиля; ×5–20 при промахе мимо buffer pool |
| | `transactionsPerWrite`, `lockContention` | Для сценария hot-row |
| Консистентность | `isolationLevel`, `readYourWrites`, `readFromReplica` (доля чтений с реплик) | Предикаты заданий проверяют это |
| Надёжность | `backupSchedule`, `pitrDays`, `multiAz` | Хранилище бэкапов идёт в стоимость |

**Модель ёмкости Postgres (пример):**
```
capacity_read  = min( maxConnections/connPerQuery × 1000/readServiceMs ,
                      provisionedIops/iopsPerRead ,
                      cpuCores × 1000/(readServiceMs × cpuShare) )
capacity_write = min( provisionedIops/iopsPerWrite , walMbps/(rowBytes×amplification) , … )
```
`boundBy` почти всегда покажет `connections` без пулера и `iops` — с пулером. Это ровно тот инсайт,
за которым идут на интервью.

---

## 5. NoSQL и специализированные хранилища (`nosql`)

| ID | Название | Волна | Ключевые специфичные параметры | Ограничитель |
|---|---|---|---|---|
| `mongodb` | MongoDB | **M** | `replicaSetSize`, `shardCount`, `shardKey`, `writeConcern` (w:1/majority), `readPreference`, `documentSizeKb`, `indexCount`, `workingSetGb`, `wiredTigerCacheGb` | Память рабочего набора |
| `cassandra` | Cassandra | **M** | `nodes`, `replicationFactor`, `consistencyLevel` (ONE/QUORUM/ALL), `partitionKey`, `partitionSizeMb`, `compactionStrategy` (STCS/LCS/TWCS), `writeAmplification`, `tombstones`, `hintedHandoff` | Диск и compaction, запись дешёвая |
| `scylla` | ScyllaDB | V1 | то же + `shardsPerCore`, `throughputMultiplier` (≈3–5× vs Cassandra) | CPU-shard |
| `dynamodb` | DynamoDB | **M** | `capacityMode` (provisioned/on-demand), `rcu`, `wcu`, `itemSizeKb`, `partitionKey`, `hotPartitionRisk`, `gsiCount` (каждый GSI = ещё WCU), `ttlEnabled`, `streams`, `costPerMillionRW` | RCU/WCU и **горячая партиция (3000 RCU / 1000 WCU на партицию)** |
| `hbase` | HBase | V2 | `regionServers`, `regionsPerServer`, `hdfsReplication` | Регионы |
| `couchbase` | Couchbase | V2 | `buckets`, `memoryQuotaGb`, `ejectionPolicy` | Память |
| `redis-store` | Redis как основное хранилище | V1 | `persistence` (none/RDB/AOF), `durabilityRisk`, `memoryGb`, `evictionPolicy: noeviction` | Память и durability |
| `neo4j` | Neo4j / графовая БД | V1 | `nodeCount`, `edgeCount`, `traversalDepth`, `cacheGb`, `queryComplexity` | Память / глубина обхода |
| `timescale` | TimescaleDB | V1 | `metricsPerSec`, `chunkIntervalHours`, `compressionAfterDays`, `retentionDays` | Запись и сжатие |
| `influx` | InfluxDB | V1 | `seriesCardinality`, `pointsPerSec`, `retentionPolicy` | **Кардинальность** |
| `prometheus` | Prometheus / VictoriaMetrics | V1 | `activeSeries`, `scrapeIntervalSec`, `samplesPerSec`, `bytesPerSample` (~1.7 сжатых), `retentionDays` | Кардинальность и память |
| `etcd` | etcd / ZooKeeper / Consul (KV, координация) | V1 | `nodes` (нечётное), `writeQuorumMs`, `maxDbSizeMb`, `watchers`, `leaseCount` | Кворум записи, **не масштабируется записью** |
| `s3-table` | Iceberg / Delta Lake поверх объектного хранилища | V2 | `fileSizeMb`, `partitioning`, `compaction`, `manifestOverhead` | Метаданные и compaction |

---

## 6. Поиск и векторы (`search`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `elasticsearch` | Elasticsearch / OpenSearch | **M** | `nodes`, `shardsPerIndex`, `replicas`, `docCount`, `docSizeKb`, `indexSizeGb` (обычно 1.1–2× сырых данных), `refreshIntervalSec` (влияет на «свежесть» и на throughput), `queryType` (term/match/aggregation), `heapGb`, `fieldDataCache` | Heap и число шардов |
| `meilisearch` | Meilisearch / Typesense | V1 | `docCount`, `indexRamGb`, `queryMs`, `typoTolerance` | Память |
| `solr` | Apache Solr | V2 | `shards`, `replicas`, `softCommitMs` | — |
| `vector-db` | Векторная БД (Pinecone / Milvus / Qdrant / pgvector) | V1 | `vectorCount`, `dimensions`, `indexType` (HNSW/IVF), `memoryPerVectorBytes` (`dim × 4 × 1.5`), `recallTarget`, `queryMs`, `topK` | Память (вектора живут в RAM) |
| `autocomplete` | Сервис автодополнения (Trie/FST) | V1 | `prefixCount`, `memoryGb`, `queryMs`, `updateLagMin` | Память |

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

---

## 8. Кэши (`cache`)

| ID | Название | Волна | Ключевые параметры | Ограничитель |
|---|---|---|---|---|
| `redis` | Redis (standalone / sentinel / cluster) | **M** | `mode`, `shards`, `replicasPerShard`, `memoryGb`, `evictionPolicy` (LRU/LFU/TTL/noeviction), `ttlSec`, `keySizeBytes`, `valueSizeBytes`, `overheadPerKeyBytes` (~50–100), `maxOpsPerSec` (~80–150k/ядро), `pipelining`, `maxConnections`, `persistence`, `clusterHashSlots`, `hotKeyRisk` | Память → затем ops/sec одного ядра |
| `memcached` | Memcached | V1 | `memoryGb`, `slabSize`, `threads`, `maxOpsPerSec` | Память |
| `local-cache` | In-process кэш (Caffeine / LRU) | **M** | `sizeMb`, `ttlSec`, `perInstance: true`, `coherenceRisk` (рассогласование между инстансами!) | Память процесса, консистентность |
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

**Hit ratio по умолчанию считается, а не задаётся** — из распределения Zipf по ключам и размера кэша
(см. [02-simulation.md](02-simulation.md), §6). Ручной override доступен, но помечается как «допущение».

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
| `hdfs` | HDFS | V2 | `nodes`, `blockSizeMb`, `replication` (3), `namenodeMemory` | Метаданные namenode |
| `ftp-legacy` | Legacy файловый сервер | V2 | `throughputMbs`, `concurrency` | — |

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
| `region` | Регион | **M** | `code` (`us-east-1`, `eu-west-1`, `ap-southeast-1`…), `geo`, `availability`, `dataResidency` (none/GDPR/local-only), `isPrimary`, `mirrorOf` (id региона-шаблона), `trafficShare` (авто из гео-маршрутизации), `costMultiplier` (регионы стоят по-разному) |
| `az` | Availability Zone | **M** | `id`, `intraAzLatencyMs` (0.25), `failureProbability` |
| `vpc` | VPC / подсеть | V1 | `cidr`, `natRequired` |
| `k8s-cluster` | Kubernetes-кластер | V1 | `nodes`, `nodeType`, `podsPerNode`, `schedulingLagSec`, `controlPlaneCost` |
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

| Группа | Блоков всего | В MVP (**M**) |
|---|---|---|
| clients | 7 | 2 |
| edge | 12 | 6 |
| compute | 13 | 4 |
| sql | 8 | 2 |
| nosql | 13 | 3 |
| search | 5 | 1 |
| olap | 7 | 1 |
| cache | 5 | 2 |
| messaging | 12 | 4 |
| storage | 7 | 2 |
| platform | 15 | 2 |
| observability | 6 | 2 |
| topology | 8 | 6 |
| probes | 11 | 7 |
| **Итого** | **129** | **44** |

Прирост первой волны с 39 до 44 блоков — следствие решения **D1** (мультирегион в MVP):
в неё добавлены `region`, `link-cross-region`, `multi-region-policy`, `dns` и `glb`.

Порядок отображения групп в палитре повторяет порядок этого документа — он же порядок
регистрации в `ComponentRegistry` (как `registry.registerGroup(...)` в `initPlugins.ts` у dsp-flow).
