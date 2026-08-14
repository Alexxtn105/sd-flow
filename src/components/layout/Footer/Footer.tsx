import { useTranslation } from 'react-i18next';
import { useGraphStore } from '../../../store/graphStore';
import StorageService from '../../../services/storageService';
import { formatBytes } from '../../../utils/format';
import './Footer.css';

export default function Footer() {
    const { t } = useTranslation();
    const nodes = useGraphStore((state) => state.nodes);
    const edges = useGraphStore((state) => state.edges);
    const revision = useGraphStore((state) => state.revision);

    const groups = nodes.filter((node) => node.type === 'group').length;
    const blocks = nodes.length - groups;

    return (
        <footer className="ftr">
            <div className="ftr-stats">
                <span className="ftr-stat">
                    <b>{blocks}</b> {t('footer.nodes')}
                </span>
                <span className="ftr-stat">
                    <b>{edges.length}</b> {t('footer.edges')}
                </span>
                <span className="ftr-stat">
                    <b>{groups}</b> {t('footer.groups')}
                </span>
            </div>

            <div className="ftr-phase">{t('footer.phase')}</div>

            <div className="ftr-version" title={t('footer.version')}>
                v{__APP_VERSION__}
            </div>

            <div className="ftr-storage" key={revision}>
                {formatBytes(StorageService.usedBytes())} {t('footer.storage')}
            </div>
        </footer>
    );
}
