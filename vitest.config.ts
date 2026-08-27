import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'react-icons/fa': path.resolve(__dirname, 'stubs/react-icons-fa.tsx'),
      'react-icons/si': path.resolve(__dirname, 'stubs/react-icons-si.tsx'),
      'react-icons/vsc': path.resolve(__dirname, 'stubs/react-icons-vsc.tsx'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
