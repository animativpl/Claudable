import { describe, expect, it } from 'vitest';
import { getFileIcon } from '@/components/chat/TreeView';
import { FaFolder, FaFile } from 'react-icons/fa';
import { SiTypescript } from 'react-icons/si';

// No @testing-library/react in this project's dependencies (checked package.json),
// so these assertions inspect the returned React element's shape directly rather
// than rendering it, matching this project's existing lightweight test style.

describe('getFileIcon', () => {
  it('returns a distinct icon for a directory vs a .ts file vs an unrecognized extension', () => {
    const dirIcon = getFileIcon({ path: 'src', type: 'dir' });
    const tsIcon = getFileIcon({ path: 'index.ts', type: 'file' });
    const unknownIcon = getFileIcon({ path: 'notes.xyz', type: 'file' });

    const dirInner = (dirIcon.props as any).children;
    const tsInner = (tsIcon.props as any).children;
    const unknownInner = (unknownIcon.props as any).children;

    expect(dirInner.type).toBe(FaFolder);
    expect(tsInner.type).toBe(SiTypescript);
    expect(unknownInner.type).toBe(FaFile);

    expect(dirInner.type).not.toBe(tsInner.type);
    expect(tsInner.type).not.toBe(unknownInner.type);
    expect(dirInner.type).not.toBe(unknownInner.type);
  });

  it('gives directories the folder icon regardless of path', () => {
    const icon = getFileIcon({ path: 'anything.ts', type: 'dir' });
    expect(((icon.props as any).children as any).type).toBe(FaFolder);
  });
});
