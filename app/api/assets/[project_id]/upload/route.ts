import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getProjectById } from '@/lib/services/project';
import { resolveProjectRoot } from '@/lib/utils/project-path';
import { resolveAssetsPath, mirrorAssetToPublic } from '@/lib/services/assets';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const project = await getProjectById(project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'File field is required' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ success: false, error: 'File must be an image' }, { status: 400 });
    }

    const projectAssetsPath = resolveAssetsPath(project_id);
    await fs.mkdir(projectAssetsPath, { recursive: true });

    const originalName = file.name || 'image.png';
    const extension = path.extname(originalName) || '.png';
    const uniqueName = `${randomUUID()}${extension}`;
    const absolutePath = path.join(projectAssetsPath, uniqueName);
    const resolvedAbsolutePath = path.resolve(absolutePath);

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(resolvedAbsolutePath, Buffer.from(arrayBuffer));

    const projectRoot = resolveProjectRoot(project_id, project.repoPath);
    const { publicPath, publicUrl } = await mirrorAssetToPublic(projectRoot, uniqueName, resolvedAbsolutePath);

    return NextResponse.json({
      success: true,
      path: `assets/${uniqueName}`,
      absolute_path: resolvedAbsolutePath,
      filename: uniqueName,
      original_filename: originalName,
      public_path: publicPath,
      public_url: publicUrl,
    });
  } catch (error) {
    console.error('[Assets Upload] Failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to upload image',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
