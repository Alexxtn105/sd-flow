export const CHALLENGE_TEMPLATE = `id: my-challenge
level: 2
estimatedMinutes: 30
tags: [cache, cost]

title:
  ru: Моё задание
  en: My challenge

brief:
  ru: |
    Опишите задачу: что за система, какая нагрузка и что важно проверить.
  en: |
    Describe the task: what the system is, the load it carries and what matters.

given:
  dau: 2000000
  peakFactor: 3

flows:
  - id: users
    name: { ru: Просмотр, en: View }
    weightInScore: 1

constraints:
  maxNodes: 10
  allowedGroups: [clients, edge, compute, cache, sql, storage, topology]

requirements:
  - id: R1
    kind: slo
    desc: { ru: p99 не выше 250 мс, en: p99 stays under 250 ms }
    flow: users
    metric: latency.p99
    max: 250
  - id: R2
    kind: capacity
    desc: { ru: Ни один блок не загружен выше 80%, en: No block runs hotter than 80% }
    maxUtilization: 0.8
  - id: R3
    kind: budget
    desc: { ru: Стоимость не выше $50 000 в месяц, en: Monthly cost stays under $50k }
    maxMonthlyCostUsd: 50000

bonusObjectives:
  - id: B1
    kind: slo
    desc: { ru: Медиана укладывается в 90 мс, en: Median stays under 90 ms }
    flow: users
    metric: latency.p50
    max: 90

scenarios:
  required: [peak]
  bonus: [az-failure]

relaxation:
  peak: { utilizationFactor: 1.1 }

lockedParams:
  users:
    dau: 2000000
    peakFactor: 3

starter:
  nodes:
    - { id: users, type: client-web, params: { dau: 2000000, peakFactor: 3 } }
  links: []

hints:
  - level: 1
    cost: 5
    text: { ru: С чего начать разбор нагрузки?, en: Where would you start reading the load? }
`;
