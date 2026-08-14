import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: '/sd-flow/',
    plugins: [react()],
    test: {
        environment: 'jsdom',
        include: ['tests/**/*.test.ts'],
    },
});
