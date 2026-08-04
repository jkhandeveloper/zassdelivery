import { Injectable } from '@nestjs/common';
import { DriverEarningType } from '@prisma/client';

/** The rates a delivery is paid at, read from platform settings. */
export interface EarningRates {
  /** Paid for taking the run at all, regardless of distance. */
  baseFare: number;
  perKm: number;
  /** Share of the customer's tip that reaches the rider, 0–100. */
  tipSharePercentage: number;
  /** Floor on what a single delivery pays, however short the trip. */
  minimumFare: number;
}

export interface EarningComponent {
  type: DriverEarningType;
  amount: number;
  description: string;
}

export interface EarningBreakdown {
  components: EarningComponent[];
  total: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Works out what a delivery pays.
 *
 * Kept as a pure calculator with the rates passed in: what riders are paid is
 * commercial policy that will be tuned from the settings table, and mixing that
 * with database access would make every rate change a code change.
 */
@Injectable()
export class EarningsCalculator {
  /**
   * Itemises a completed delivery.
   *
   * The breakdown is stored line by line rather than as a single figure so a
   * rider can see how the amount was reached — "why was this run only 90
   * rupees" is the most common question a support desk gets, and an itemised
   * ledger answers it without anyone recomputing history.
   */
  calculate(
    input: { distanceKm: number | null; tipAmount: number },
    rates: EarningRates,
  ): EarningBreakdown {
    const components: EarningComponent[] = [
      {
        type: DriverEarningType.BASE_FARE,
        amount: round(rates.baseFare),
        description: 'Base fare',
      },
    ];

    const distanceKm = input.distanceKm ?? 0;

    if (distanceKm > 0 && rates.perKm > 0) {
      components.push({
        type: DriverEarningType.DISTANCE,
        amount: round(distanceKm * rates.perKm),
        description: `Distance — ${distanceKm} km at Rs. ${rates.perKm}/km`,
      });
    }

    // The fare floor tops up the run rather than replacing the itemisation, so
    // the rider can still see what the base and distance actually came to.
    const fareSoFar = components.reduce((sum, component) => sum + component.amount, 0);

    if (fareSoFar < rates.minimumFare) {
      components.push({
        type: DriverEarningType.ADJUSTMENT,
        amount: round(rates.minimumFare - fareSoFar),
        description: `Minimum fare top-up to Rs. ${rates.minimumFare}`,
      });
    }

    // The tip is the customer's money, not the platform's. It is passed through
    // as its own line so nobody has to take on trust that it arrived.
    if (input.tipAmount > 0 && rates.tipSharePercentage > 0) {
      components.push({
        type: DriverEarningType.TIP,
        amount: round((input.tipAmount * rates.tipSharePercentage) / 100),
        description: 'Customer tip',
      });
    }

    return {
      components,
      total: round(components.reduce((sum, component) => sum + component.amount, 0)),
    };
  }

  /**
   * What a rider is quoted before they accept.
   *
   * The tip is excluded deliberately: a customer may add or remove one after
   * the offer is made, and quoting money that can vanish is how riders learn
   * not to trust the number.
   */
  quote(distanceKm: number | null, rates: EarningRates): number {
    return this.calculate({ distanceKm, tipAmount: 0 }, rates).total;
  }
}
