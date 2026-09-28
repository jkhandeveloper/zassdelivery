import { Injectable } from '@nestjs/common';
import { DriverEarningType } from '@prisma/client';

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
 * The rider keeps what the customer paid for delivery: the delivery fee and
 * the tip. The platform pays nothing on top and holds nothing in between, so
 * there are no rates to tune here. The figure is the order's own.
 */
@Injectable()
export class EarningsCalculator {
  /**
   * Itemises a completed delivery.
   *
   * The fee and the tip are separate lines so a rider can see that the tip
   * arrived in full, and a dispute can be answered from the ledger.
   */
  calculate(input: { deliveryFee: number; tipAmount: number }): EarningBreakdown {
    const components: EarningComponent[] = [];

    if (input.deliveryFee > 0) {
      components.push({
        type: DriverEarningType.DELIVERY_FEE,
        amount: round(input.deliveryFee),
        description: 'Delivery fee',
      });
    }

    if (input.tipAmount > 0) {
      components.push({
        type: DriverEarningType.TIP,
        amount: round(input.tipAmount),
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
  quote(deliveryFee: number): number {
    return round(deliveryFee);
  }
}
