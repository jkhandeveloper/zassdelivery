import type { LoggerService } from '@nestjs/common';
import { UserRole } from '@prisma/client';

import type { TokenService } from '@/modules/auth/application/services/token.service';
import type { RefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository';
import type { FileStoragePort } from '@/modules/storage/domain/file-storage.port';

import type { UserRepository } from '../../domain/repositories/user.repository';
import { DeleteMyAccountUseCase } from './users.use-cases';

function build(role: UserRole = UserRole.CUSTOMER) {
  const users = {
    findById: jest.fn().mockResolvedValue({ id: 'user-1', role }),
    hasActiveOrders: jest.fn().mockResolvedValue(false),
    erase: jest
      .fn()
      .mockResolvedValue([
        'https://api.test/api/v1/uploads/avatars/one.jpg',
        'https://api.test/api/v1/uploads/rider-documents/two.jpg',
      ]),
  };
  const refreshTokens = { revokeAllForUser: jest.fn().mockResolvedValue(1) };
  const tokens = { revokeSession: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    isConfigured: jest.fn().mockReturnValue(true),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { warn: jest.fn() };

  return {
    users,
    refreshTokens,
    tokens,
    storage,
    logger,
    useCase: new DeleteMyAccountUseCase(
      users as unknown as UserRepository,
      refreshTokens as unknown as RefreshTokenRepository,
      tokens as unknown as TokenService,
      storage as unknown as FileStoragePort,
      logger as unknown as LoggerService,
    ),
  };
}

describe('DeleteMyAccountUseCase', () => {
  it('erases the account, ends every session and removes its files', async () => {
    const { useCase, users, refreshTokens, tokens, storage } = build();

    await useCase.execute('user-1', 'session-1');

    expect(users.erase).toHaveBeenCalledWith('user-1');
    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1', 'account_deleted');
    expect(tokens.revokeSession).toHaveBeenCalledWith('session-1');
    expect(storage.remove).toHaveBeenCalledWith('avatars/one.jpg');
    expect(storage.remove).toHaveBeenCalledWith('rider-documents/two.jpg');
  });

  it('waits for an order in progress to finish', async () => {
    const { useCase, users } = build();
    users.hasActiveOrders.mockResolvedValue(true);

    await expect(useCase.execute('user-1', 'session-1')).rejects.toThrow(/in progress/);
    expect(users.erase).not.toHaveBeenCalled();
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('refuses a %s', async (role) => {
    const { useCase, users } = build(role);

    await expect(useCase.execute('user-1', 'session-1')).rejects.toThrow(/administrator/);
    expect(users.erase).not.toHaveBeenCalled();
  });

  it('still succeeds when a file cannot be removed', async () => {
    const { useCase, storage, logger } = build();
    storage.remove.mockRejectedValue(new Error('bucket down'));

    await expect(useCase.execute('user-1', 'session-1')).resolves.toEqual({
      message: 'Your account has been deleted.',
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
