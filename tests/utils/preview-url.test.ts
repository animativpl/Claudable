import { describe, expect, it } from 'vitest';
import { toBrowsablePreviewUrl } from '@/lib/utils/preview-url';

describe('toBrowsablePreviewUrl', () => {
  it('podmienia localhost na hosta, którym przyszła przeglądarka', () => {
    expect(toBrowsablePreviewUrl('http://localhost:3100', '192.168.0.42')).toBe(
      'http://192.168.0.42:3100'
    );
  });

  it('podmienia także 127.0.0.1', () => {
    expect(toBrowsablePreviewUrl('http://127.0.0.1:3107', '192.168.0.42')).toBe(
      'http://192.168.0.42:3107'
    );
  });

  it('nie dokłada ukośnika adresowi bez ścieżki', () => {
    expect(toBrowsablePreviewUrl('http://localhost:3100', 'example.lan')).not.toMatch(/\/$/);
  });

  it('zachowuje ścieżkę i query', () => {
    expect(
      toBrowsablePreviewUrl('http://localhost:3100/blog?page=2', '192.168.0.42')
    ).toBe('http://192.168.0.42:3100/blog?page=2');
  });

  it('zostawia hosta spoza pętli zwrotnej bez zmian', () => {
    expect(
      toBrowsablePreviewUrl('https://preview.example.com', '192.168.0.42')
    ).toBe('https://preview.example.com');
  });

  it('zostawia adres bez zmian, gdy nie da się go sparsować', () => {
    expect(toBrowsablePreviewUrl('nie-adres', '192.168.0.42')).toBe('nie-adres');
  });

  it('zostawia pusty adres pusty', () => {
    expect(toBrowsablePreviewUrl('', '192.168.0.42')).toBe('');
  });

  it('zostawia adres bez zmian, gdy nie znamy hosta przeglądarki', () => {
    expect(toBrowsablePreviewUrl('http://localhost:3100', '')).toBe('http://localhost:3100');
  });

  it('jest idempotentna dla adresu już wskazującego na hosta przeglądarki', () => {
    const once = toBrowsablePreviewUrl('http://localhost:3100', '192.168.0.42');
    expect(toBrowsablePreviewUrl(once, '192.168.0.42')).toBe(once);
  });
});
