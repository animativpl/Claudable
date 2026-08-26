/**
 * GET /api/projects/[project_id]/routes
 * Discover navigable routes from project source files.
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { resolveProjectRoot } from '@/lib/utils/project-path';
import { getProjectById } from '@/lib/services/project';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

async function walkDir(dir: string, extensions: string[]): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

function nextjsFileToRoute(filePath: string, appDir: string): string {
  const relative = path.relative(appDir, filePath);
  const dir = path.dirname(relative);
  const segments = dir === '.' ? [] : dir.split(path.sep);
  // Strip route groups (segment) and parallel routes @slot
  const routeSegments = segments.filter(seg => !seg.startsWith('(') && !seg.startsWith('@'));
  return routeSegments.length === 0 ? '/' : '/' + routeSegments.join('/');
}

function astroFileToRoute(filePath: string, pagesDir: string): string {
  const relative = path.relative(pagesDir, filePath);
  const withoutExt = relative.replace(/\.(astro|md|mdx)$/, '');
  const normalized = withoutExt.split(path.sep).join('/');
  const withoutIndex = normalized.replace(/(?:^|\/)index$/, '');
  if (!withoutIndex) return '/';
  return withoutIndex.startsWith('/') ? withoutIndex : '/' + withoutIndex;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const project = await getProjectById(project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const projectRoot = resolveProjectRoot(project_id, project.repoPath);
    const routes = new Set<string>();
    routes.add('/');

    // Next.js App Router
    const appDir = path.join(projectRoot, 'app');
    const nextFiles = await walkDir(appDir, ['.tsx', '.jsx', '.js', '.ts', '.mdx']);
    for (const f of nextFiles) {
      const name = path.basename(f, path.extname(f));
      if (name === 'page') {
        routes.add(nextjsFileToRoute(f, appDir));
      }
    }

    // Astro pages
    const pagesDir = path.join(projectRoot, 'src', 'pages');
    const astroFiles = await walkDir(pagesDir, ['.astro', '.md', '.mdx']);
    for (const f of astroFiles) {
      routes.add(astroFileToRoute(f, pagesDir));
    }

    const sorted = Array.from(routes).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ success: true, routes: sorted });
  } catch (error) {
    console.error('[API] Failed to discover project routes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to discover routes' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
