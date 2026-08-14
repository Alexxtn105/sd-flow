import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

export default defineConfig({
    base: '/sd-flow/',
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
    },
});
