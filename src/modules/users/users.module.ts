import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AddressRepository } from './domain/repositories/address.repository';
import { FavoriteRepository } from './domain/repositories/favorite.repository';
import { NotificationPreferenceRepository } from './domain/repositories/notification-preference.repository';
import { UserRepository } from './domain/repositories/user.repository';
import { PrismaAddressRepository } from './infrastructure/repositories/prisma-address.repository';
import { PrismaFavoriteRepository } from './infrastructure/repositories/prisma-favorite.repository';
import { PrismaNotificationPreferenceRepository } from './infrastructure/repositories/prisma-notification-preference.repository';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import {
  CreateAddressUseCase,
  DeleteAddressUseCase,
  GetAddressUseCase,
  ListAddressesUseCase,
  SetDefaultAddressUseCase,
  UpdateAddressUseCase,
} from './application/use-cases/addresses.use-cases';
import {
  AddFavoriteUseCase,
  ListFavoritesUseCase,
  RemoveFavoriteUseCase,
} from './application/use-cases/favorites.use-cases';
import {
  GetNotificationPreferencesUseCase,
  GetProfileUseCase,
  ResetNotificationPreferencesUseCase,
  UpdateNotificationPreferencesUseCase,
  UpdateProfileUseCase,
} from './application/use-cases/profile.use-cases';
import {
  ChangeUserStatusUseCase,
  CreateUserUseCase,
  DeleteUserUseCase,
  GetUserUseCase,
  ListUsersUseCase,
  RestoreUserUseCase,
  UpdateUserUseCase,
} from './application/use-cases/users.use-cases';
import { MeController } from './me.controller';
import { UsersController } from './users.controller';

@Module({
  // AuthModule supplies PasswordService for admin-created accounts and
  // RefreshTokenRepository so a role change or suspension can end sessions.
  imports: [AuthModule],
  controllers: [UsersController, MeController],
  providers: [
    ListUsersUseCase,
    GetUserUseCase,
    CreateUserUseCase,
    UpdateUserUseCase,
    ChangeUserStatusUseCase,
    DeleteUserUseCase,
    RestoreUserUseCase,

    GetProfileUseCase,
    UpdateProfileUseCase,
    GetNotificationPreferencesUseCase,
    UpdateNotificationPreferencesUseCase,
    ResetNotificationPreferencesUseCase,

    ListAddressesUseCase,
    GetAddressUseCase,
    CreateAddressUseCase,
    UpdateAddressUseCase,
    SetDefaultAddressUseCase,
    DeleteAddressUseCase,

    ListFavoritesUseCase,
    AddFavoriteUseCase,
    RemoveFavoriteUseCase,

    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: AddressRepository, useClass: PrismaAddressRepository },
    { provide: FavoriteRepository, useClass: PrismaFavoriteRepository },
    {
      provide: NotificationPreferenceRepository,
      useClass: PrismaNotificationPreferenceRepository,
    },
  ],
  // NotificationPreferenceRepository is exported for the notifications module:
  // the preference matrix is edited here as part of a profile, and honoured
  // there on every send.
  exports: [UserRepository, AddressRepository, NotificationPreferenceRepository],
})
export class UsersModule {}
