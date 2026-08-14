import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import initComponents from './engine/initComponents';
import { ThemeProvider } from './contexts/ThemeContext';
import { TouchProvider } from './contexts/TouchContext';
import { registerServiceWorker } from './services/serviceWorker';
import App from './App';

import './locales/i18n';
import './styles/index.css';

const container = document.querySelector('#app');

if (!container) {
    throw new Error('Контейнер #app не найден');
}

try {
    initComponents();
} catch (error) {
    container.textContent = 'Ошибка инициализации каталога блоков. Перезагрузите страницу.';
    throw error;
}

registerServiceWorker();

createRoot(container).render(
    <StrictMode>
        <ThemeProvider>
            <TouchProvider>
                <App />
            </TouchProvider>
        </ThemeProvider>
    </StrictMode>,
);
