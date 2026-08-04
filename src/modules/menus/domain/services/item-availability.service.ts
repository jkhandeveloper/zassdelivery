import { DayOfWeek, MenuItemStatus, type MenuItem, type MenuVariant } from '@prisma/client';

const DAYS_FROM_SUNDAY: DayOfWeek[] = [
  DayOfWeek.SUNDAY,
  DayOfWeek.MONDAY,
  DayOfWeek.TUESDAY,
  DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY,
  DayOfWeek.FRIDAY,
  DayOfWeek.SATURDAY,
];

export interface ItemAvailability {
  isAvailable: boolean;
  /** Machine-readable cause when unavailable, for the client to branch on. */
  reason: 'available' | 'hidden' | 'out_of_stock' | 'outside_window' | 'sold_out';
  isLowStock: boolean;
  /** Remaining units, or null when this item does not track stock. */
  stockRemaining: number | null;
}

/**
 * Decides whether a dish can be ordered right now.
 *
 * Three independent things can make an item unorderable — the owner hid it, the
 * kitchen ran out, or it is outside its serving window — and a client needs to
 * tell them apart to show the right message. Collapsing them into one boolean
 * would lose that.
 */
export class ItemAvailabilityService {
  constructor(private readonly timezone = 'Asia/Karachi') {}

  private localNow(now: Date): { minutes: number; day: DayOfWeek } {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);

    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);

    return {
      minutes: (hour % 24) * 60 + minute,
      day: DAYS_FROM_SUNDAY[index === -1 ? 0 : index] ?? DayOfWeek.SUNDAY,
    };
  }

  private static toMinutes(time: string): number {
    const [hours, minutes] = time.split(':');
    return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  }

  evaluate(item: MenuItem, now: Date = new Date()): ItemAvailability {
    const stockRemaining = item.trackInventory ? item.stockQuantity : null;
    const isLowStock =
      item.trackInventory && item.stockQuantity > 0 && item.stockQuantity <= item.lowStockThreshold;

    if (item.status === MenuItemStatus.HIDDEN) {
      return { isAvailable: false, reason: 'hidden', isLowStock, stockRemaining };
    }

    if (item.status === MenuItemStatus.OUT_OF_STOCK) {
      return { isAvailable: false, reason: 'out_of_stock', isLowStock, stockRemaining };
    }

    if (item.trackInventory && item.stockQuantity <= 0) {
      return { isAvailable: false, reason: 'sold_out', isLowStock: false, stockRemaining: 0 };
    }

    if (!this.isWithinWindow(item, now)) {
      return { isAvailable: false, reason: 'outside_window', isLowStock, stockRemaining };
    }

    return { isAvailable: true, reason: 'available', isLowStock, stockRemaining };
  }

  /** A variant is orderable only if it is enabled and has stock of its own. */
  isVariantAvailable(variant: MenuVariant): boolean {
    if (!variant.isAvailable) {
      return false;
    }

    return !variant.trackInventory || variant.stockQuantity > 0;
  }

  private isWithinWindow(item: MenuItem, now: Date): boolean {
    const { minutes, day } = this.localNow(now);

    // An empty day list means "every day" — the common case, so it stays the
    // default rather than requiring all seven to be listed.
    if (item.availableDays.length > 0 && !item.availableDays.includes(day)) {
      return false;
    }

    if (item.availableFrom === null || item.availableTo === null) {
      return true;
    }

    const from = ItemAvailabilityService.toMinutes(item.availableFrom);
    const to = ItemAvailabilityService.toMinutes(item.availableTo);

    // A window that ends at or before it starts runs past midnight.
    return to > from ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  }
}
