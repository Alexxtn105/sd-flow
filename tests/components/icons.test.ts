import { describe, expect, it } from 'vitest';
import iconGlyph from '../../src/components/common/Icons/iconGlyph';
import UI_ICONS from '../../src/components/common/Icons/UiIcons';
import indexHtml from '../../index.html?raw';
import iconCss from '../../src/components/common/Icons/Icon.css?raw';

const SOURCES: Record<string, string> = import.meta.glob('../../src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
});

const USED_IN_APP = [
    'add_circle_outline',
    'arrow_back',
    'assignment',
    'cancel',
    'check_circle',
    'chevron_left',
    'chevron_right',
    'close',
    'code',
    'content_copy',
    'content_paste',
    'dark_mode',
    'dashboard',
    'delete',
    'delete_outline',
    'description',
    'download',
    'edit',
    'expand_less',
    'expand_more',
    'file_download',
    'file_upload',
    'fit_screen',
    'folder_open',
    'help_outline',
    'image',
    'legend_toggle',
    'light_mode',
    'lightbulb_outline',
    'link_off',
    'lock',
    'logout',
    'map',
    'my_location',
    'note_add',
    'open_in_new',
    'play_arrow',
    'redo',
    'save',
    'save_as',
    'school',
    'search',
    'share',
    'star',
    'star_border',
    'thermostat',
    'timer',
    'tune',
    'undo',
    'unfold_less',
    'unfold_more',
    'upload',
    'visibility',
    'visibility_off',
];

function attributeNames(): Set<string> {
    const names = new Set<string>();

    for (const [path, source] of Object.entries(SOURCES)) {
        if (!path.endsWith('.tsx')) continue;

        for (const match of source.matchAll(/name="([a-z_0-9-]+)"/g)) names.add(match[1]);
        for (const match of source.matchAll(/name=\{([^}]*)\}/g)) {
            for (const quoted of match[1].matchAll(/'([a-z_0-9-]+)'/g)) names.add(quoted[1]);
        }
    }

    return names;
}

function mentionedInSources(name: string): boolean {
    return Object.entries(SOURCES).some(
        ([path, source]) =>
            !path.includes('/Icons/') && (source.includes(`'${name}'`) || source.includes(`"${name}"`)),
    );
}

describe('иконки интерфейса', () => {
    it('нарисованы все имена, которые использует приложение', () => {
        const missing = USED_IN_APP.filter((name) => iconGlyph(name) === undefined);

        expect(missing).toEqual([]);
        expect(USED_IN_APP.length).toBe(Object.keys(UI_ICONS).length);
    });

    it('не оставляет висячих иконок в наборе', () => {
        const unused = Object.keys(UI_ICONS).filter((name) => !mentionedInSources(name));

        expect(unused).toEqual([]);
    });

    it('каждое имя из разметки компонентов нарисовано', () => {
        const unknown = [...attributeNames()].filter(
            (name) => !name.startsWith('sd-') && iconGlyph(name) === undefined,
        );

        expect(unknown).toEqual([]);
    });

    it('шрифт со стороннего домена больше не подключается', () => {
        expect(indexHtml).not.toContain('fonts.googleapis.com');
        expect(indexHtml).not.toContain('Material+Icons');
        expect(iconCss).not.toContain('material-icons');
    });

    it('рисует своим контуром даже неизвестное имя', () => {
        expect(iconGlyph('нет-такой-иконки')).toBeUndefined();
    });
});
