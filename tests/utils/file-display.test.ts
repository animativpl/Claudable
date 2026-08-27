import { describe, expect, it } from 'vitest';
import { getFileLanguage, escapeHtml } from '@/lib/utils/file-display';

describe('getFileLanguage', () => {
  it('maps .ts and .tsx to typescript', () => {
    expect(getFileLanguage('app.tsx')).toBe('typescript');
    expect(getFileLanguage('lib/utils.ts')).toBe('typescript');
  });

  it('maps .js, .jsx, .mjs to javascript', () => {
    expect(getFileLanguage('index.js')).toBe('javascript');
    expect(getFileLanguage('component.jsx')).toBe('javascript');
    expect(getFileLanguage('module.mjs')).toBe('javascript');
  });

  it('maps .py to python', () => {
    expect(getFileLanguage('script.py')).toBe('python');
  });

  it('maps .md and .markdown to markdown', () => {
    expect(getFileLanguage('README.md')).toBe('markdown');
    expect(getFileLanguage('NOTES.markdown')).toBe('markdown');
  });

  it('maps .yaml/.yml to yaml', () => {
    expect(getFileLanguage('docker-compose.yaml')).toBe('yaml');
    expect(getFileLanguage('config.yml')).toBe('yaml');
  });

  it('maps .conf/.config to nginx', () => {
    expect(getFileLanguage('nginx.conf')).toBe('nginx');
    expect(getFileLanguage('app.config')).toBe('nginx');
  });

  it('returns plaintext for an unrecognized extension', () => {
    expect(getFileLanguage('file.xyz')).toBe('plaintext');
  });

  it('is case-insensitive on the extension', () => {
    expect(getFileLanguage('App.TSX')).toBe('typescript');
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \' in order', () => {
    expect(escapeHtml('<div class="a">it\'s & fun</div>')).toBe(
      '&lt;div class=&quot;a&quot;&gt;it&#39;s &amp; fun&lt;/div&gt;'
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('returns an empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});
