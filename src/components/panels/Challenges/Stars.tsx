import { useTranslation } from 'react-i18next';
import Icon from '../../common/Icons/Icon';

const STAR_SLOTS = [0, 1, 2];

export default function Stars({ value }: { value: number }) {
    const { t } = useTranslation();
    const label = t('challenge.starsEarned', { value, total: STAR_SLOTS.length });

    return (
        <span className="chl-stars" title={label} aria-label={label}>
            {STAR_SLOTS.map((slot) => (
                <Icon
                    key={slot}
                    name={slot < value ? 'star' : 'star_border'}
                    size="small"
                    className={slot < value ? 'chl-star-on' : 'chl-star-off'}
                />
            ))}
        </span>
    );
}
