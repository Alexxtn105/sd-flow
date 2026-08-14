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
    'sd-bff': (
        <>
            <path d="M2.5 6h4M2.5 12h4M2.5 18h4" />
            <path d="M6.5 5 13 10.5v3L6.5 19" />
            <path d="M13 12h8.5" />
        </>
    ),
    'sd-cron': (
        <>
            <circle cx="12" cy="13" r="7.5" />
            <path d="M12 9v4l2.5 2" />
            <path d="M8 3.5 5.5 6M16 3.5 18.5 6" />
        </>
    ),
    'sd-batch': (
        <>
            <rect x="2.5" y="4" width="9" height="16" rx="1.5" />
            <path d="M2.5 9.3h9M2.5 14.7h9" />
            <path d="M14 12h7.5" />
            <path d="M18.5 9 21.5 12l-3 3" />
        </>
    ),
    'sd-stream-processor': (
        <>
            <path d="M2.5 12h5" />
            <rect x="7.5" y="6.5" width="9" height="11" rx="2" />
            <path d="M10 9.5 13.5 12 10 14.5" />
            <path d="M16.5 12h5" />
        </>
    ),
    'sd-transcoder': (
        <>
            <rect x="2.5" y="6" width="9.5" height="12" rx="2" />
            <path d="M6.2 9.3 9.5 12l-3.3 2.7z" fill="currentColor" />
            <path d="M14.5 7.5h7M14.5 12h5M14.5 16.5h3" />
        </>
    ),
    'sd-ml-inference': (
        <>
            <circle cx="4.8" cy="6.5" r="2.5" />
            <circle cx="4.8" cy="17.5" r="2.5" />
            <circle cx="12" cy="12" r="2.5" />
            <circle cx="19.2" cy="12" r="2.5" />
            <path d="M6.8 8 10 10.5M6.8 16 10 13.5M14.5 12h2.2" />
        </>
    ),
    'sd-search-indexer': (
        <>
            <rect x="8.5" y="3.5" width="13" height="17" rx="2" />
            <path d="M11.5 7.5h7M11.5 12h7M11.5 16.5h4.5" />
            <path d="M2.5 12h5M5 9.5 7.5 12 5 14.5" />
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
    'sd-client-iot': (
        <>
            <rect x="2.5" y="11" width="12" height="9" rx="2" />
            <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" />
            <path d="M14.5 7A4 4 0 0 1 18.5 11" />
            <path d="M14.5 4A7 7 0 0 1 21.5 11" />
        </>
    ),
    'sd-client-api': (
        <>
            <rect x="2.5" y="3.5" width="13" height="10" rx="2" />
            <path d="M2.5 7.5h13" />
            <circle cx="14.5" cy="17" r="2.8" />
            <path d="M17.3 17h4.2M19.3 17v2.2M21 17v2.2" />
        </>
    ),
    'sd-client-bot': (
        <>
            <rect x="3.5" y="7.5" width="17" height="12" rx="3" />
            <circle cx="9" cy="13.5" r="1.4" fill="currentColor" />
            <circle cx="15" cy="13.5" r="1.4" fill="currentColor" />
            <path d="M12 7.5V5" />
            <circle cx="12" cy="3.7" r="1.3" fill="currentColor" />
        </>
    ),
    'sd-client-loadtest': (
        <>
            <rect x="2.5" y="4" width="19" height="16" rx="2" />
            <path d="M4.5 18h3.5v-3.5h3.5V11H15V7.5h3.5" />
        </>
    ),
    'sd-client-internal': (
        <>
            <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
            <circle cx="12" cy="10" r="2.6" />
            <path d="M6.5 18.5a5.5 5.5 0 0 1 11 0" />
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
    'sd-waf': (
        <>
            <path d="M12 2.5 20 5.5v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10v-6z" />
            <path d="M7.5 8.5h9l-3.5 4.3v4.2l-2-1.2v-3z" />
        </>
    ),
    'sd-rate-limiter': (
        <>
            <path d="M3 4.5h18" />
            <path d="M5 4.5v9a4.5 4.5 0 0 0 4.5 4.5h5a4.5 4.5 0 0 0 4.5-4.5v-9" />
            <circle cx="10" cy="10.5" r="1.5" fill="currentColor" />
            <circle cx="14.3" cy="13.3" r="1.5" fill="currentColor" />
            <path d="M12 20v1.5" />
        </>
    ),
    'sd-reverse-cache': (
        <>
            <rect x="6.5" y="3.5" width="11" height="17" rx="2.5" />
            <path d="M13.2 7.5 9.8 13h2.7l-.5 4 3.4-5.5h-2.7z" />
            <path d="M2.5 12h4M4.5 10 6.5 12l-2 2" />
            <path d="M17.5 12h4" />
        </>
    ),
    'sd-ws-gateway': (
        <>
            <rect x="2.5" y="4" width="5.5" height="16" rx="1.5" />
            <rect x="16" y="4" width="5.5" height="16" rx="1.5" />
            <path d="M8.5 9.5h7M13 7.5 15.5 9.5 13 11.5" />
            <path d="M15.5 15h-7M11 13l-2.5 2 2.5 2" />
        </>
    ),
    'sd-service-mesh': (
        <>
            <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
            <rect x="5" y="7.5" width="9" height="9" rx="1.5" />
            <rect x="15.5" y="7.5" width="3.5" height="9" rx="1.2" />
            <path d="M14 12h1.5" />
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
    'sd-sql-managed': (
        <>
            <path d="M15.3 9.4H8.6a2.4 2.4 0 0 1 0-4.8 3.6 3.6 0 0 1 5.4-1.5 3.4 3.4 0 0 1 1.3 6.3z" />
            <path d="M5 13.5a7 2.2 0 1 0 14 0a7 2.2 0 1 0-14 0" />
            <path d="M5 13.5v6c0 1.2 3.13 2.2 7 2.2s7-1 7-2.2v-6" />
        </>
    ),
    'sd-sql-sharded': (
        <>
            <path d="M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0" />
            <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
            <path d="M8 8.6v12M16 8.6v12" />
        </>
    ),
    'sd-sql-distributed': (
        <>
            <path d="M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0" />
            <path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
            <path d="M12 9.5 17 17.5H7z" />
            <circle cx="12" cy="9.5" r="1.1" fill="currentColor" />
            <circle cx="7" cy="17.5" r="1.1" fill="currentColor" />
            <circle cx="17" cy="17.5" r="1.1" fill="currentColor" />
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
    'sd-graph': (
        <>
            <circle cx="6" cy="6.5" r="2.8" />
            <circle cx="18" cy="9" r="2.8" />
            <circle cx="10.5" cy="18" r="2.8" />
            <path d="M8.7 7.1 15.3 8.4M7 9.1 9.5 15.4M16.2 11.2 12.3 15.8" />
        </>
    ),
    'sd-timeseries': (
        <>
            <path d="M2.5 14.5 5.5 8l3 8L12 6l3.5 9 3-5 3 3.5" />
            <path d="M2.5 20.5h19" />
        </>
    ),
    'sd-coordination': (
        <>
            <path d="M12 4.2 19.4 9.6 16.6 18.3H7.4L4.6 9.6z" />
            <circle cx="12" cy="4.2" r="1.9" fill="currentColor" />
            <circle cx="19.4" cy="9.6" r="1.9" fill="currentColor" />
            <circle cx="16.6" cy="18.3" r="1.9" fill="currentColor" />
            <circle cx="7.4" cy="18.3" r="1.9" fill="currentColor" />
            <circle cx="4.6" cy="9.6" r="1.9" fill="currentColor" />
        </>
    ),
    'sd-search': (
        <>
            <path d="M3 5h16M3 9.5h13M3 14h7" />
            <circle cx="15" cy="15.5" r="4" />
            <path d="M17.9 18.4 20.5 21" />
        </>
    ),
    'sd-vector': (
        <>
            <circle cx="11.5" cy="12" r="6.8" />
            <circle cx="11.5" cy="12" r="1.7" fill="currentColor" />
            <circle cx="8" cy="8.8" r="1.4" fill="currentColor" />
            <circle cx="15" cy="9.2" r="1.4" fill="currentColor" />
            <circle cx="14" cy="16" r="1.4" fill="currentColor" />
            <circle cx="20" cy="18.5" r="1.4" fill="currentColor" />
        </>
    ),
    'sd-autocomplete': (
        <>
            <rect x="2.5" y="3.5" width="19" height="6.5" rx="2" />
            <path d="M6 5.5v3" />
            <path d="M8.5 6.75h5" />
            <path d="M5.5 14h13M5.5 18.5h9" />
        </>
    ),
    'sd-olap': (
        <>
            <path d="M2.5 7 12 2.5 21.5 7v10L12 21.5 2.5 17z" />
            <path d="M2.5 7 12 11.5l9.5-4.5" />
            <path d="M12 11.5v10" />
        </>
    ),
    'sd-olap-managed': (
        <>
            <path d="M15.3 9.4H8.6a2.4 2.4 0 0 1 0-4.8 3.6 3.6 0 0 1 5.4-1.5 3.4 3.4 0 0 1 1.3 6.3z" />
            <path d="M6.8 13.8 12 11.3l5.2 2.5v5.5L12 21.7l-5.2-2.4z" />
            <path d="M6.8 13.8 12 16.2l5.2-2.4M12 16.2v5.5" />
        </>
    ),
    'sd-query-engine': (
        <>
            <rect x="4.5" y="3" width="15" height="9" rx="2.5" />
            <path d="M8 6.2 10.4 7.6 8 9" />
            <path d="M12.4 9h3.6" />
            <path d="M5 20.5v-3.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3.5" />
            <path d="M12 12v8.5" />
        </>
    ),
    'sd-lakehouse': (
        <>
            <path d="M2.5 8q3.2-3 6.33 0t6.34 0 6.33 0" />
            <path d="M2.5 13q3.2-3 6.33 0t6.34 0 6.33 0" />
            <path d="M2.5 18q3.2-3 6.33 0t6.34 0 6.33 0" />
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
    'sd-fanout': (
        <>
            <circle cx="4.5" cy="12" r="2.5" />
            <path d="M7 12h3.5" />
            <path d="M10.5 12 17.4 6.3M10.5 12h6.5M10.5 12 17.4 17.7" />
            <circle cx="19" cy="5" r="2" fill="currentColor" />
            <circle cx="19" cy="12" r="2" fill="currentColor" />
            <circle cx="19" cy="19" r="2" fill="currentColor" />
        </>
    ),
    'sd-outbox': (
        <>
            <path d="M2.5 8a4 1.8 0 1 0 8 0a4 1.8 0 1 0-8 0" />
            <path d="M2.5 8v7c0 1 1.79 1.8 4 1.8s4-.8 4-1.8V8" />
            <path d="M11 12.5h2.5" />
            <rect x="13.5" y="8.5" width="8" height="7" rx="1.5" />
            <path d="M13.5 10.2 17.5 13.2l4-3" />
        </>
    ),
    'sd-cdc': (
        <>
            <path d="M2.5 6.5a5.5 2.2 0 1 0 11 0a5.5 2.2 0 1 0-11 0" />
            <path d="M2.5 6.5v9.5c0 1.2 2.46 2.2 5.5 2.2s5.5-1 5.5-2.2V6.5" />
            <path d="M14.5 12h7M19.4 9.8 21.6 12l-2.2 2.2" />
            <circle cx="16.5" cy="12" r="1.3" fill="currentColor" />
        </>
    ),
    'sd-scheduler-queue': (
        <>
            <path d="M2.5 7h11M2.5 17h11" />
            <circle cx="5.5" cy="12" r="2" />
            <circle cx="10.5" cy="12" r="2" />
            <circle cx="17.5" cy="12" r="4" />
            <path d="M17.5 9.3V12l2 1.4" />
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
    'sd-archive': (
        <>
            <rect x="2.5" y="4" width="19" height="5" rx="1.5" />
            <path d="M4.5 9v9.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9" />
            <path d="M9.5 13.5h5" />
        </>
    ),
    'sd-file-share': (
        <>
            <path d="M2.5 19V6.5a2 2 0 0 1 2-2h3.5l2 2.5H15a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2z" />
            <path d="M17 9.5h2M17 15.5h2" />
            <circle cx="20.5" cy="9.5" r="1.2" fill="currentColor" />
            <circle cx="20.5" cy="15.5" r="1.2" fill="currentColor" />
        </>
    ),
    'sd-block-device': (
        <>
            <rect x="2.5" y="7" width="19" height="10" rx="2" />
            <circle cx="8" cy="12" r="3" />
            <circle cx="8" cy="12" r="0.9" fill="currentColor" />
            <path d="M13.5 15h5" />
            <circle cx="18.5" cy="9.5" r="1" fill="currentColor" />
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
    'sd-session': (
        <>
            <path d="M2.5 8.5V6a1.5 1.5 0 0 1 1.5-1.5h16A1.5 1.5 0 0 1 21.5 6v2.5a3.5 3.5 0 0 0 0 7V18a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18v-2.5a3.5 3.5 0 0 0 0-7z" />
            <path d="M7 10.5h7M7 14h4.5" />
        </>
    ),
    'sd-config': (
        <>
            <rect x="2.5" y="4.5" width="19" height="6" rx="3" />
            <circle cx="17.5" cy="7.5" r="1.8" fill="currentColor" />
            <rect x="2.5" y="13.5" width="19" height="6" rx="3" />
            <circle cx="6.5" cy="16.5" r="1.8" fill="currentColor" />
        </>
    ),
    'sd-discovery': (
        <>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.3" />
            <path d="M12 12 18.4 5.6" />
            <circle cx="16.2" cy="14.8" r="1.5" fill="currentColor" />
        </>
    ),
    'sd-secrets': (
        <>
            <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
            <circle cx="12.5" cy="12" r="3.5" />
            <path d="M12.5 12h4.5" />
            <path d="M6.5 3.5v17" />
        </>
    ),
    'sd-lock': (
        <>
            <rect x="4" y="10" width="16" height="10.5" rx="2.5" />
            <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
            <circle cx="12" cy="15.2" r="1.6" fill="currentColor" />
        </>
    ),
    'sd-id-gen': (
        <>
            <path d="M6 4.5 4 19.5M13 4.5 11 19.5" />
            <path d="M3 9h11M2.5 15h11" />
            <path d="M18.5 20V6M15.5 9 18.5 6l3 3" />
        </>
    ),
    'sd-notification': (
        <>
            <path d="M5.5 16.5h13c-1.2-1.2-1.8-2.6-1.8-4.2V10a4.7 4.7 0 0 0-9.4 0v2.3c0 1.6-.6 3-1.8 4.2z" />
            <path d="M9.8 19.5a2.2 2.2 0 0 0 4.4 0" />
            <path d="M12 5.3V3.5" />
        </>
    ),
    'sd-webhook': (
        <>
            <rect x="2.5" y="3.5" width="9" height="9" rx="2" />
            <path d="M7 12.5v4a3 3 0 0 0 3 3h9.5" />
            <path d="M17.5 17 20 19.5l-2.5 2.5" />
        </>
    ),
    'sd-payment': (
        <>
            <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
            <path d="M2.5 9h19" />
            <rect x="5.5" y="12" width="4.5" height="3.5" rx="0.8" />
            <path d="M13 16.5h5.5" />
        </>
    ),
    'sd-saga': (
        <>
            <circle cx="5" cy="8" r="2.5" />
            <circle cx="12" cy="8" r="2.5" />
            <circle cx="19" cy="8" r="2.5" />
            <path d="M7.5 8h2M14.5 8h2" />
            <path d="M19 10.5v4.5a2.5 2.5 0 0 1-2.5 2.5H6.5" />
            <path d="M8.5 15.5 6 17.5l2.5 2" />
        </>
    ),
    'sd-geo-index': (
        <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 9.7h18M3 14.3h18M9 5v14M15 5v14" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
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
    'sd-traces': (
        <>
            <path d="M2.5 5h19" />
            <path d="M5 5v14h4M5 12h4" />
            <path d="M9 12h10M9 19h7" />
        </>
    ),
    'sd-apm': (
        <>
            <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" />
            <path d="M2.5 8h19" />
            <path d="M6 17v-3.5M10 17v-6M14 17v-4" />
            <circle cx="18.5" cy="14" r="2.6" />
        </>
    ),
    'sd-audit-log': (
        <>
            <rect x="2.5" y="2.5" width="12" height="19" rx="2" />
            <path d="M5.5 7h6M5.5 11h6M5.5 15h4" />
            <circle cx="17" cy="17" r="4.3" />
            <path d="M15.2 17.1 16.5 18.4 18.9 15.7" />
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
    'sd-nat-egress': (
        <>
            <path d="M2.5 6.5h3.5l3 5.5M2.5 12h3.5M2.5 17.5h3.5l3-5.5" />
            <path d="M9 12h11.5" />
            <path d="M17 8.5 20.5 12 17 15.5" />
            <path d="M13.5 3v3M13.5 9.5v1M13.5 13.5v1M13.5 18v3" />
        </>
    ),
    'sd-vpc': (
        <>
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <rect x="4.2" y="9" width="6" height="6" rx="1.2" />
            <rect x="13.8" y="9" width="6" height="6" rx="1.2" />
            <path d="M10.2 12h3.6" />
        </>
    ),
    'sd-k8s': (
        <>
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <rect x="8.5" y="5.5" width="7" height="4.5" rx="1.2" />
            <rect x="4.5" y="14" width="5" height="5" rx="1.2" />
            <rect x="14.5" y="14" width="5" height="5" rx="1.2" />
            <path d="M12 10v2.5M7 14v-1.5h10V14" />
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
    'sd-probe-availability': (
        <>
            <circle cx="12" cy="12" r="9.5" />
            <path d="M4.5 12h3l2-3.5 2.5 7 2-3.5h5" />
        </>
    ),
    'sd-probe-traffic': (
        <>
            <circle cx="10.5" cy="9.5" r="6" />
            <path d="M14.8 13.8 19.5 18.5" />
            <path d="M6.5 9.5h8M12.2 7.2 14.5 9.5l-2.3 2.3" />
        </>
    ),
    'sd-probe-heatmap': (
        <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
            <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" />
            <rect x="15" y="9" width="6" height="6" fill="currentColor" fillOpacity="0.5" stroke="none" />
            <rect x="9" y="15" width="6" height="6" fill="currentColor" fillOpacity="0.25" stroke="none" />
        </>
    ),
    'sd-probe-waterfall': (
        <>
            <path d="M3 5h12M6.5 9.5h10M10 14h8M13.5 18.5h6.5" />
            <path d="M3 21.5h18.5" />
        </>
    ),
};

export default SD_ICONS;
