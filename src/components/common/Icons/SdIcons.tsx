import type { ReactNode } from 'react';

const SD_ICONS: Record<string, ReactNode> = {
    'sd-service': (
        <>
            <rect x="3" y="4" width="18" height="6" rx="1.5" />
            <rect x="3" y="14" width="18" height="6" rx="1.5" />
            <path d="M6.5 7h.01M6.5 17h.01" />
        </>
    ),
    'sd-monolith': (
        <>
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M4 9h16M4 15h16" />
            <path d="M12 15v6" />
        </>
    ),
    'sd-serverless': (
        <>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="M12.5 6.5 8.5 13h3.5l-.5 4.5L15.5 11H12z" />
        </>
    ),
    'sd-worker': (
        <>
            <circle cx="14.5" cy="12" r="3.5" />
            <path d="M14.5 6.5v2M14.5 15.5v2M18 12h2M11 12H9" />
            <path d="M2.5 12h4.5" />
            <path d="M5 9.5 7.5 12 5 14.5" />
        </>
    ),
    'sd-client-web': (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18" />
            <path d="M6 6.5h.01M9 6.5h.01" />
            <path d="M12.5 6.5H18" />
        </>
    ),
    'sd-client-mobile': (
        <>
            <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
            <path d="M10.5 5.5h3" />
            <path d="M12 18.5h.01" />
        </>
    ),
    'sd-dns': (
        <>
            <circle cx="9" cy="9" r="6.5" />
            <path d="M2.5 9h13" />
            <path d="M9 2.5c3.2 3.6 3.2 9.4 0 13-3.2-3.6-3.2-9.4 0-13z" />
            <path d="M13.2 13.2 21 16.4l-3.3 1.3-1.3 3.3z" fill="currentColor" />
        </>
    ),
    'sd-cdn': (
        <>
            <circle cx="12" cy="12" r="3" />
            <path d="M9.9 9.9 6.5 6.5M14.1 9.9 17.5 6.5M9.9 14.1 6.5 17.5M14.1 14.1 17.5 17.5" />
            <path d="M4.5 4.5h.01M19.5 4.5h.01M4.5 19.5h.01M19.5 19.5h.01" />
        </>
    ),
    'sd-glb': (
        <>
            <circle cx="8" cy="12" r="5.5" />
            <path d="M2.5 12h11" />
            <path d="M8 6.5c2.7 3.1 2.7 7.9 0 11-2.7-3.1-2.7-7.9 0-11z" />
            <path d="M14.5 8H19M14.5 16H19" />
            <path d="M16.5 5.5 19 8l-2.5 2.5M16.5 13.5 19 16l-2.5 2.5" />
        </>
    ),
    'sd-lb-l4': (
        <>
            <path d="M2.5 12H11" />
            <path d="M11 6v12" />
            <path d="M11 6h9M11 12h9M11 18h9" />
        </>
    ),
    'sd-lb-l7': (
        <>
            <path d="M2.5 12h3" />
            <circle cx="8.5" cy="12" r="3" />
            <path d="M6.4 14.1 4.6 15.9" />
            <path d="M11.5 12H14M14 7v10" />
            <path d="M14 7h6.5M14 12h6.5M14 17h6.5" />
        </>
    ),
    'sd-gateway': (
        <>
            <path d="M3 21V11a9 9 0 0 1 18 0v10" />
            <path d="M2.5 21h19" />
            <path d="M8.5 16h6" />
            <path d="M12 13.5 14.5 16 12 18.5" />
        </>
    ),
    'sd-sql': (
        <>
            <path d="M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0" />
            <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
            <path d="M4 10c0 1.66 3.58 3 8 3s8-1.34 8-3" />
            <path d="M4 14c0 1.66 3.58 3 8 3s8-1.34 8-3" />
        </>
    ),
    'sd-document': (
        <>
            <path d="M3 5.5a6 2.5 0 1 0 12 0a6 2.5 0 1 0-12 0" />
            <path d="M3 5.5v9c0 1.3 2.4 2.4 5.5 2.5" />
            <path d="M15 5.5v3.5" />
            <path d="M12 12.5h4l3 3V21h-7z" />
            <path d="M16 12.5v3h3" />
        </>
    ),
    'sd-wide-column': (
        <>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 9v11M15 9v11" />
        </>
    ),
    'sd-keyvalue': (
        <>
            <circle cx="6" cy="12" r="3.5" />
            <path d="M9.5 12H15" />
            <path d="M11.5 12v3M13.5 12v2.5" />
            <rect x="15" y="6" width="6.5" height="12" rx="1.5" />
        </>
    ),
    'sd-search': (
        <>
            <path d="M3 5h16M3 9.5h13M3 14h7" />
            <circle cx="15" cy="15.5" r="4" />
            <path d="M17.9 18.4 20.5 21" />
        </>
    ),
    'sd-olap': (
        <>
            <path d="M2.5 7 12 2.5 21.5 7v10L12 21.5 2.5 17z" />
            <path d="M2.5 7 12 11.5l9.5-4.5" />
            <path d="M12 11.5v10" />
        </>
    ),
    'sd-cache': (
        <>
            <path d="M4 5.5a8 2.5 0 1 0 16 0a8 2.5 0 1 0-16 0" />
            <path d="M4 5.5v12c0 1.4 3.58 2.5 8 2.5s8-1.1 8-2.5v-12" />
            <path d="M13 9 9.5 14.5h3L12 18l3.5-5.5h-3z" />
        </>
    ),
    'sd-local-cache': (
        <>
            <rect x="5" y="5" width="14" height="14" rx="2.5" />
            <path d="M9.5 2.5V5M14.5 2.5V5M9.5 19v2.5M14.5 19v2.5" />
            <path d="M13 8 10 12.5h2.5l-.5 3.5 3-4.5h-2.5z" />
        </>
    ),
    'sd-log-stream': (
        <>
            <rect x="2.5" y="7" width="15" height="10" rx="1.5" />
            <path d="M7.5 7v10M12.5 7v10" />
            <path d="M17.5 12h4" />
            <path d="M19 9.5 21.5 12 19 14.5" />
        </>
    ),
    'sd-queue': (
        <>
            <path d="M2.5 7h19M2.5 17h19" />
            <circle cx="7" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="17" cy="12" r="2" />
        </>
    ),
    'sd-queue-managed': (
        <>
            <path d="M18 17H7a4 4 0 0 1 0-8 6 6 0 0 1 9-2.5A5.4 5.4 0 0 1 18 17z" />
            <path d="M7.5 10.5h9M7.5 15h9" />
            <circle cx="10.5" cy="12.75" r="1.5" />
            <circle cx="14.5" cy="12.75" r="1.5" />
        </>
    ),
    'sd-dlq': (
        <>
            <path d="M2.5 7.5h12M2.5 16.5h12" />
            <circle cx="7" cy="12" r="2" />
            <path d="M16.5 9 21.5 14M21.5 9l-5 5" />
        </>
    ),
    'sd-bucket': (
        <>
            <path d="M3.5 7.5a8.5 2.5 0 1 0 17 0a8.5 2.5 0 1 0-17 0" />
            <path d="M4 8.4l1.5 11.3a2 2 0 0 0 2 1.8h9a2 2 0 0 0 2-1.8L20 8.4" />
        </>
    ),
    'sd-bucket-self': (
        <>
            <rect x="2.5" y="3.5" width="19" height="17" rx="2" />
            <path d="M7 9a5 1.6 0 1 0 10 0a5 1.6 0 1 0-10 0" />
            <path d="M7.4 9.9l.9 6.3a1.4 1.4 0 0 0 1.4 1.2h4.6a1.4 1.4 0 0 0 1.4-1.2l.9-6.3" />
        </>
    ),
    'sd-auth': (
        <>
            <path d="M12 2.5 20 5.5v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10v-6z" />
            <circle cx="12" cy="10.5" r="2.2" />
            <path d="M12 12.7v3.8" />
            <path d="M12 15h2" />
        </>
    ),
    'sd-external': (
        <>
            <path d="M13.5 3.5H5.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-8" />
            <path d="M14 10 20.5 3.5" />
            <path d="M15 3.5h5.5V9" />
        </>
    ),
    'sd-logs': (
        <>
            <rect x="3" y="3.5" width="18" height="17" rx="2" />
            <path d="M6.5 8.5h.01M6.5 12h.01M6.5 15.5h.01" />
            <path d="M9.5 8.5h8M9.5 12h8M9.5 15.5h5" />
        </>
    ),
    'sd-metrics': (
        <>
            <path d="M3.5 3.5v17h17" />
            <path d="M7 16.5 11 12l3.5 3.5 5-6.5" />
            <circle cx="19.5" cy="9" r="1.2" fill="currentColor" />
        </>
    ),
    'sd-region': (
        <>
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M12 17.8c2.4-3 3.6-5.2 3.6-6.5a3.6 3.6 0 1 0-7.2 0c0 1.3 1.2 3.5 3.6 6.5z" />
            <circle cx="12" cy="11.3" r="1.3" />
        </>
    ),
    'sd-az': (
        <>
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <rect x="8" y="7" width="8" height="10" rx="1" />
            <path d="M8 10.5h8M8 14h8" />
        </>
    ),
    'sd-link': (
        <>
            <circle cx="5.5" cy="12" r="1.8" fill="currentColor" />
            <circle cx="18.5" cy="12" r="1.8" fill="currentColor" />
            <path d="M7.5 12h9" />
        </>
    ),
    'sd-link-region': (
        <>
            <circle cx="5.5" cy="12" r="3.5" />
            <circle cx="18.5" cy="12" r="3.5" />
            <path d="M9.6 12h1.6M12.8 12h1.6" />
        </>
    ),
    'sd-internet': (
        <>
            <circle cx="12" cy="12" r="9.5" />
            <path d="M2.5 12h19" />
            <path d="M12 2.5c3.8 4.7 3.8 14.3 0 19-3.8-4.7-3.8-14.3 0-19z" />
        </>
    ),
    'sd-policy': (
        <>
            <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
            <path d="M14 2.5V8h5.5" />
            <path d="M8.5 14.5 11 17l4.5-5" />
        </>
    ),
    'sd-probe-rps': (
        <>
            <path d="M4 18.5a9.5 9.5 0 1 1 16 0" />
            <path d="M12 14 16.2 9.8" />
            <circle cx="12" cy="14" r="1.1" fill="currentColor" />
        </>
    ),
    'sd-probe-latency': (
        <>
            <path d="M3.5 20.5h17" />
            <path d="M6.5 20.5v-4.5M11 20.5v-12M15 20.5v-8M18.5 20.5v-4" />
        </>
    ),
    'sd-probe-utilization': (
        <>
            <path d="M13.5 4.5v9.6a3.6 3.6 0 1 1-3.6 0V4.5a1.8 1.8 0 0 1 3.6 0z" />
            <path d="M11.7 10v7.2" />
            <path d="M16.5 7h3M16.5 11h3M16.5 15h3" />
        </>
    ),
    'sd-probe-queue': (
        <>
            <path d="M3 8h12M3 12h12M3 16h12M3 20h12" />
            <path d="M19 6.5v15" />
            <path d="M17 8.5 19 6.5l2 2M17 19.5l2 2 2-2" />
        </>
    ),
    'sd-probe-storage': (
        <>
            <path d="M4 5.5a7 2.5 0 1 0 14 0a7 2.5 0 1 0-14 0" />
            <path d="M4 5.5v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-12" />
            <path d="M4 13.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
            <path d="M19 13.5 21.5 11.8v3.4z" fill="currentColor" />
        </>
    ),
    'sd-probe-cost': (
        <>
            <circle cx="12" cy="12" r="9.5" />
            <path d="M15.5 8.5H10a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8.5" />
            <path d="M12 18.5v-13" />
        </>
    ),
    'sd-probe-slo': (
        <>
            <circle cx="12" cy="12" r="9.5" />
            <circle cx="12" cy="12" r="5.5" />
            <path d="M9.6 12.2 11.3 13.9 14.5 10.4" />
        </>
    ),
};

Object.assign(SD_ICONS, {
    'sd-client-iot': SD_ICONS['sd-client-mobile'],
    'sd-client-api': SD_ICONS['sd-client-web'],
    'sd-client-bot': SD_ICONS['sd-worker'],
    'sd-client-loadtest': SD_ICONS['sd-probe-rps'],
    'sd-client-internal': SD_ICONS['sd-service'],
    'sd-waf': SD_ICONS['sd-auth'],
    'sd-rate-limiter': SD_ICONS['sd-probe-utilization'],
    'sd-reverse-cache': SD_ICONS['sd-cache'],
    'sd-ws-gateway': SD_ICONS['sd-gateway'],
    'sd-service-mesh': SD_ICONS['sd-cdn'],
    'sd-bff': SD_ICONS['sd-gateway'],
    'sd-cron': SD_ICONS['sd-probe-latency'],
    'sd-batch': SD_ICONS['sd-worker'],
    'sd-stream-processor': SD_ICONS['sd-log-stream'],
    'sd-transcoder': SD_ICONS['sd-worker'],
    'sd-ml-inference': SD_ICONS['sd-service'],
    'sd-search-indexer': SD_ICONS['sd-search'],
    'sd-sql-managed': SD_ICONS['sd-sql'],
    'sd-sql-sharded': SD_ICONS['sd-wide-column'],
    'sd-sql-distributed': SD_ICONS['sd-sql'],
    'sd-graph': SD_ICONS['sd-cdn'],
    'sd-timeseries': SD_ICONS['sd-metrics'],
    'sd-coordination': SD_ICONS['sd-policy'],
    'sd-vector': SD_ICONS['sd-search'],
    'sd-autocomplete': SD_ICONS['sd-search'],
    'sd-olap-managed': SD_ICONS['sd-olap'],
    'sd-query-engine': SD_ICONS['sd-olap'],
    'sd-lakehouse': SD_ICONS['sd-bucket'],
    'sd-fanout': SD_ICONS['sd-cdn'],
    'sd-outbox': SD_ICONS['sd-queue'],
    'sd-cdc': SD_ICONS['sd-link-region'],
    'sd-scheduler-queue': SD_ICONS['sd-queue'],
    'sd-archive': SD_ICONS['sd-bucket'],
    'sd-file-share': SD_ICONS['sd-bucket-self'],
    'sd-block-device': SD_ICONS['sd-sql'],
    'sd-session': SD_ICONS['sd-keyvalue'],
    'sd-config': SD_ICONS['sd-policy'],
    'sd-discovery': SD_ICONS['sd-dns'],
    'sd-secrets': SD_ICONS['sd-auth'],
    'sd-lock': SD_ICONS['sd-auth'],
    'sd-id-gen': SD_ICONS['sd-keyvalue'],
    'sd-notification': SD_ICONS['sd-external'],
    'sd-webhook': SD_ICONS['sd-external'],
    'sd-payment': SD_ICONS['sd-external'],
    'sd-saga': SD_ICONS['sd-policy'],
    'sd-geo-index': SD_ICONS['sd-region'],
    'sd-traces': SD_ICONS['sd-link'],
    'sd-apm': SD_ICONS['sd-metrics'],
    'sd-audit-log': SD_ICONS['sd-logs'],
    'sd-vpc': SD_ICONS['sd-region'],
    'sd-k8s': SD_ICONS['sd-az'],
    'sd-probe-availability': SD_ICONS['sd-probe-slo'],
    'sd-probe-traffic': SD_ICONS['sd-probe-rps'],
    'sd-probe-heatmap': SD_ICONS['sd-probe-utilization'],
    'sd-probe-waterfall': SD_ICONS['sd-probe-latency'],
});

export default SD_ICONS;
