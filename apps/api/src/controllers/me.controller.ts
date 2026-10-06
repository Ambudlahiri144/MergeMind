import type { MeResponse } from '@mergemind/shared';
import type { RequestHandler } from 'express';

import { validate } from '../middleware/validate.js';
import type { AccessService } from '../services/access.service.js';

/** `GET /me`: who you are and the installations you can see. */
export function getMe(access: AccessService): RequestHandler {
  return validate({}, async ({ user }) => {
    const installations = await access.listAccessible(user);
    const body: MeResponse = {
      user: { githubUserId: user.githubUserId, login: user.login },
      installations: installations.map(({ installation, role }) => ({
        id: installation.id,
        githubInstallationId: installation.githubInstallationId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        status: installation.status,
        role,
        allowedProviders: installation.allowedProviders,
      })),
    };
    return { status: 200, body };
  });
}
