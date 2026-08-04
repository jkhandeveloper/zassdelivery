import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '@/common/decorators/api-paginated-response.decorator';
import { Public } from '@/common/decorators/public.decorator';
import type { PaginatedResult } from '@/common/interfaces/paginated-result.interface';

import { ListMenuItemsQueryDto } from './application/dto/menu-query.dto';
import { MenuDto, MenuItemDto, MenuItemImageDto } from './application/dto/menu-response.dto';
import {
  GetMenuItemUseCase,
  ListMenuItemsUseCase,
  MenuItemImagesUseCase,
} from './application/use-cases/menu-items.use-cases';
import { GetPublicMenuUseCase } from './application/use-cases/menus.use-cases';

/**
 * The public menu. Unauthenticated — customers browse before signing in — and
 * only ever exposes active menus, active sections and non-hidden dishes.
 */
@ApiTags('Menus')
@Public()
@Controller()
export class MenusController {
  constructor(
    private readonly publicMenu: GetPublicMenuUseCase,
    private readonly listItems: ListMenuItemsUseCase,
    private readonly getItem: GetMenuItemUseCase,
    private readonly images: MenuItemImagesUseCase,
  ) {}

  @Get('restaurants/:restaurantId/menu')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Get the full menu for a restaurant',
    description:
      'Active menus with their active sections and item counts, ready to render ' +
      'the storefront in one request.',
  })
  @ApiResponse({ status: 200, type: [MenuDto] })
  menu(@Param('restaurantId') restaurantId: string): Promise<MenuDto[]> {
    return this.publicMenu.execute(restaurantId);
  }

  @Get('restaurants/:restaurantId/menu-items')
  @ApiParam({ name: 'restaurantId' })
  @ApiOperation({
    summary: 'Search a restaurant menu',
    description:
      'Paginated, filterable and sortable. Each item carries isAvailable plus ' +
      'an availabilityReason, so the client can tell "sold out" from "not ' +
      'served at this hour" and show the right message.',
  })
  @ApiPaginatedResponse(MenuItemDto)
  items(
    @Param('restaurantId') restaurantId: string,
    @Query() query: ListMenuItemsQueryDto,
  ): Promise<PaginatedResult<MenuItemDto>> {
    return this.listItems.execute(restaurantId, query);
  }

  @Get('menu-items/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Get a dish',
    description: 'Includes variants, option groups and the image gallery.',
  })
  @ApiResponse({ status: 200, type: MenuItemDto })
  @ApiResponse({ status: 404, description: 'No visible dish with that id.' })
  item(@Param('id') id: string): Promise<MenuItemDto> {
    return this.getItem.execute(id);
  }

  @Get('menu-items/:id/images')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Get a dish gallery' })
  @ApiResponse({ status: 200, type: [MenuItemImageDto] })
  itemImages(@Param('id') id: string): Promise<MenuItemImageDto[]> {
    return this.images.list(id);
  }
}
