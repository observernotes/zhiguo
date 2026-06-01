import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { projectsDb } from '@/modules/database/index.js';
import { userDb } from '@/modules/database/repositories/users.js';
import { createProject } from '@/modules/projects/services/project-management.service.js';

export function isZhiguoMode(): boolean {
  return process.env.ZHIGUO_MODE === 'true';
}

export function sanitizeUsernameForPath(username: string): string {
  const trimmed = username.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_');
  return safe || 'user';
}

export function getZhiguoUsersRoot(): string {
  return (
    process.env.ZHIGUO_USERS_ROOT ||
    path.join(os.homedir(), 'Documents', '智果用户')
  );
}

export function getUserWorkspacePath(username: string): string {
  return path.join(getZhiguoUsersRoot(), sanitizeUsernameForPath(username));
}

/** 注册/登录时为用户创建目录并登记为 Claude 工作区项目 */
export async function provisionUserWorkspace(
  userId: number,
  username: string,
): Promise<{ workspacePath: string; projectId: string | null }> {
  const workspacePath = getUserWorkspacePath(username);
  await fs.mkdir(workspacePath, { recursive: true });

  const existing = projectsDb.getProjectPath(workspacePath);
  let projectId: string | null = existing?.project_id ?? null;

  if (!existing) {
    const created = await createProject({
      projectPath: workspacePath,
      customName: '我的对话',
    });
    projectId = created.project.projectId;
  }

  userDb.updateGitConfig(userId, username, `${sanitizeUsernameForPath(username)}@zhiguo.local`);
  userDb.completeOnboarding(userId);

  return { workspacePath, projectId };
}
