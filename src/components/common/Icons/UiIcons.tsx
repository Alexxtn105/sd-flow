import type { ReactNode } from 'react';

const UI_ICONS: Record<string, ReactNode> = {
    add_circle_outline: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v9M7.5 12h9" />
        </>
    ),
    arrow_back: (
        <>
            <path d="M20.5 12H3.5" />
            <path d="M9.5 6 3.5 12l6 6" />
        </>
    ),
    assignment: (
        <>
            <path d="M9 4.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2H15" />
            <rect x="9" y="2.5" width="6" height="4" rx="1.5" />
            <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
        </>
    ),
    cancel: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M8.8 8.8 15.2 15.2M15.2 8.8 8.8 15.2" />
        </>
    ),
    check_circle: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.2 10.9 15.1 16.2 9.4" />
        </>
    ),
    chevron_left: (
        <>
            <path d="M15 5.5 8.5 12l6.5 6.5" />
        </>
    ),
    chevron_right: (
        <>
            <path d="M9 5.5 15.5 12 9 18.5" />
        </>
    ),
    close: (
        <>
            <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
        </>
    ),
    code: (
        <>
            <path d="M8.5 8 4.5 12l4 4" />
            <path d="M15.5 8l4 4-4 4" />
            <path d="M13.5 6.5 10.5 17.5" />
        </>
    ),
    content_copy: (
        <>
            <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
            <path d="M6.5 15.5h-1a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </>
    ),
    content_paste: (
        <>
            <path d="M8.5 4.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-13a2 2 0 0 0-2-2h-1.5" />
            <rect x="8.5" y="2.5" width="7" height="4.2" rx="1.4" />
        </>
    ),
    dark_mode: (
        <>
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
        </>
    ),
    dashboard: (
        <>
            <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
            <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
            <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
            <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
        </>
    ),
    delete: (
        <>
            <path d="M3.8 7h16.4" />
            <path d="M9.2 7V5a1.6 1.6 0 0 1 1.6-1.6h2.4A1.6 1.6 0 0 1 14.8 5v2" />
            <path d="M6 7l1 12.5a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7" />
            <path d="M10.2 11v6M13.8 11v6" />
        </>
    ),
    delete_outline: (
        <>
            <path d="M4.8 7.5h14.4" />
            <path d="M9.6 7.5V5.4a1.6 1.6 0 0 1 1.6-1.6h1.6a1.6 1.6 0 0 1 1.6 1.6v2.1" />
            <path d="M6.9 7.5v11.2a2.5 2.5 0 0 0 2.5 2.5h5.2a2.5 2.5 0 0 0 2.5-2.5V7.5" />
        </>
    ),
    description: (
        <>
            <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
            <path d="M14 3.5V8h4.5" />
            <path d="M8.5 11.5h7M8.5 15h7M8.5 18.5h4" />
        </>
    ),
    download: (
        <>
            <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
            <path d="M12 3.5v10.5" />
            <path d="M7.5 9.5 12 14l4.5-4.5" />
        </>
    ),
    edit: (
        <>
            <path d="M16.2 4.3a2.5 2.5 0 0 1 3.5 3.5L8.4 19.1l-4.6 1.1 1.1-4.6z" />
            <path d="M14.5 6 18 9.5" />
        </>
    ),
    expand_less: (
        <>
            <path d="M6 14.5 12 8.5 18 14.5" />
        </>
    ),
    expand_more: (
        <>
            <path d="M6 9.5 12 15.5 18 9.5" />
        </>
    ),
    file_download: (
        <>
            <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
            <path d="M14 3.5V8h4.5" />
            <path d="M12 10.5v6" />
            <path d="M9.4 13.9 12 16.5 14.6 13.9" />
        </>
    ),
    file_upload: (
        <>
            <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
            <path d="M14 3.5V8h4.5" />
            <path d="M12 16.5v-6" />
            <path d="M9.4 13.1 12 10.5 14.6 13.1" />
        </>
    ),
    fit_screen: (
        <>
            <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
            <path d="M6.9 6.8 10.6 10.5M6.8 10.2V6.8h3.4" />
            <path d="M17.1 17.2 13.4 13.5M17.2 13.8v3.4h-3.4" />
        </>
    ),
    folder_open: (
        <>
            <path d="M3 19.5V6.2A1.7 1.7 0 0 1 4.7 4.5h3.4a1.7 1.7 0 0 1 1.36.68l1.04 1.42h6.3a1.7 1.7 0 0 1 1.7 1.7v2.2" />
            <path d="M5.9 13h13.9a1.6 1.6 0 0 1 1.55 2l-1.2 4.5a1.9 1.9 0 0 1-1.84 1.4H4.6A1.6 1.6 0 0 1 3.05 18.9l1.3-4.7A1.6 1.6 0 0 1 5.9 13z" />
        </>
    ),
    help_outline: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.1 9.4a3 3 0 0 1 5.9 1c0 2-2.95 2.6-2.95 4.4" />
            <path d="M12 17.2h.01" />
        </>
    ),
    image: (
        <>
            <rect x="3" y="4.5" width="18" height="15" rx="2" />
            <circle cx="8.5" cy="9.5" r="1.6" />
            <path d="M4 18.2 9.2 12.6l3.4 3.5 2.4-2.4 4.9 4.7" />
        </>
    ),
    legend_toggle: (
        <>
            <rect x="2.5" y="4" width="19" height="16" rx="2" />
            <path d="M5.5 11 9 7l3.5 3.5 5-4.5" />
            <path d="M5.5 15h13M5.5 17.8h8" />
        </>
    ),
    light_mode: (
        <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6" />
            <path d="M5.6 5.6 7.45 7.45M16.55 16.55 18.4 18.4M18.4 5.6 16.55 7.45M7.45 16.55 5.6 18.4" />
        </>
    ),
    lightbulb_outline: (
        <>
            <circle cx="12" cy="9.5" r="5.4" />
            <path d="M9.5 14v3.2M14.5 14v3.2" />
            <rect x="9.4" y="17.2" width="5.2" height="3.6" rx="1.2" />
            <path d="M9.4 19h5.2" />
        </>
    ),
    link_off: (
        <>
            <path d="M13.4 6.9 15 5.3a3.5 3.5 0 0 1 4.9 4.9l-1.6 1.6" />
            <path d="M10.6 17.1 9 18.7a3.5 3.5 0 0 1-4.9-4.9l1.6-1.6" />
            <path d="M9.9 14.1 11.4 12.6M12.6 11.4 14.1 9.9" />
        </>
    ),
    lock: (
        <>
            <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            <circle cx="12" cy="15.7" r="1.4" fill="currentColor" />
        </>
    ),
    logout: (
        <>
            <path d="M10 20.5H5.5a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2H10" />
            <path d="M16 16.5 20.5 12 16 7.5" />
            <path d="M20.5 12H9.5" />
        </>
    ),
    map: (
        <>
            <path d="M9 3.5 3.5 6v14.5L9 18l6 2.5 5.5-2.5V3.5L15 6z" />
            <path d="M9 3.5v14.5M15 6v14.5" />
        </>
    ),
    my_location: (
        <>
            <circle cx="12" cy="12" r="6.5" />
            <circle cx="12" cy="12" r="1.8" fill="currentColor" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </>
    ),
    note_add: (
        <>
            <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
            <path d="M14 3.5V8h4.5" />
            <path d="M12 10.8v6M9 13.8h6" />
        </>
    ),
    open_in_new: (
        <>
            <path d="M13 4.5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7" />
            <path d="M14 10 20.5 3.5" />
            <path d="M15 3.5h5.5V9" />
        </>
    ),
    play_arrow: (
        <>
            <path d="M8.5 5 19 12 8.5 19z" fill="currentColor" />
        </>
    ),
    redo: (
        <>
            <path d="M20.5 6.5v7h-7" />
            <path d="M3 18.5a9.5 9.5 0 0 1 15.4-7.3l2.1 2.3" />
        </>
    ),
    save: (
        <>
            <path d="M3.5 6a2.5 2.5 0 0 1 2.5-2.5h10.5l4 4V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18z" />
            <rect x="8.5" y="3.5" width="6.5" height="5.5" rx="0.8" />
            <rect x="7" y="13.5" width="10" height="6" rx="1" />
        </>
    ),
    save_as: (
        <>
            <path d="M10.5 18.5H5.5A2 2 0 0 1 3.5 16.5V5.5A2 2 0 0 1 5.5 3.5h8.2L17 6.8v3.7" />
            <rect x="7" y="3.5" width="5.6" height="4" rx="0.8" />
            <path d="M18.9 12.2a1.5 1.5 0 0 1 2.1 2.1l-5.2 5.2-2.9.8.8-2.9z" />
        </>
    ),
    school: (
        <>
            <path d="M2.5 9.2 12 5l9.5 4.2L12 13.4z" />
            <path d="M6.5 11.1v4.4c0 1.9 2.5 3 5.5 3s5.5-1.1 5.5-3v-4.4" />
            <path d="M19.7 10.2v4.2" />
            <circle cx="19.7" cy="15.4" r="1" fill="currentColor" />
        </>
    ),
    search: (
        <>
            <circle cx="10.5" cy="10.5" r="7" />
            <path d="M15.6 15.6 20.5 20.5" />
        </>
    ),
    share: (
        <>
            <circle cx="18" cy="5.5" r="2.6" />
            <circle cx="6" cy="12" r="2.6" />
            <circle cx="18" cy="18.5" r="2.6" />
            <path d="M8.35 10.8 15.7 6.8M8.35 13.2 15.7 17.2" />
        </>
    ),
    star: (
        <>
            <path
                d="M12 3.2 14.1 9.6 20.8 9.6 15.4 13.5 17.4 19.8 12 15.9 6.6 19.8 8.6 13.5 3.2 9.6 9.9 9.6z"
                fill="currentColor"
            />
        </>
    ),
    star_border: (
        <>
            <path d="M12 3.2 14.1 9.6 20.8 9.6 15.4 13.5 17.4 19.8 12 15.9 6.6 19.8 8.6 13.5 3.2 9.6 9.9 9.6z" />
        </>
    ),
    thermostat: (
        <>
            <path d="M12.5 13.8V5.5a2.5 2.5 0 0 0-5 0v8.3a3.6 3.6 0 1 0 5 0z" />
            <circle cx="10" cy="16.4" r="1.5" fill="currentColor" />
            <path d="M15 7.5h2.7M15 12h2.7" />
        </>
    ),
    timer: (
        <>
            <path d="M9.5 3h5" />
            <path d="M12 3v3" />
            <circle cx="12" cy="13.5" r="7.5" />
            <path d="M12 9.8v3.7h3" />
        </>
    ),
    tune: (
        <>
            <path d="M3.5 7h4M11.5 7h9" />
            <circle cx="9.5" cy="7" r="2" />
            <path d="M3.5 12h8M15.5 12h5" />
            <circle cx="13.5" cy="12" r="2" />
            <path d="M3.5 17h2M9.5 17h11" />
            <circle cx="7.5" cy="17" r="2" />
        </>
    ),
    undo: (
        <>
            <path d="M3.5 6.5v7h7" />
            <path d="M21 18.5a9.5 9.5 0 0 0-15.4-7.3L3.5 13.5" />
        </>
    ),
    unfold_less: (
        <>
            <path d="M8.5 5 12 8.5 15.5 5" />
            <path d="M8.5 19 12 15.5 15.5 19" />
            <path d="M5 12h14" />
        </>
    ),
    unfold_more: (
        <>
            <path d="M8.5 8 12 4.5 15.5 8" />
            <path d="M8.5 16 12 19.5 15.5 16" />
            <path d="M5 12h14" />
        </>
    ),
    upload: (
        <>
            <path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
            <path d="M12 14V3.5" />
            <path d="M7.5 8 12 3.5 16.5 8" />
        </>
    ),
    visibility: (
        <>
            <path d="M2.8 12c2.1-3.9 5.2-6 9.2-6s7.1 2.1 9.2 6c-2.1 3.9-5.2 6-9.2 6s-7.1-2.1-9.2-6z" />
            <circle cx="12" cy="12" r="3.2" />
        </>
    ),
    visibility_off: (
        <>
            <path d="M2.8 12c2.1-3.9 5.2-6 9.2-6s7.1 2.1 9.2 6c-2.1 3.9-5.2 6-9.2 6s-7.1-2.1-9.2-6z" />
            <circle cx="12" cy="12" r="3.2" />
            <path d="M4.5 19.5 19.5 4.5" />
        </>
    ),
};

export default UI_ICONS;
