import { DriverEarningType } from '@prisma/client';

import { EarningsCalculator } from './earnings.calculator';

describe('EarningsCalculator.calculate', () => {
  const calculator = new EarningsCalculator();

  it('gives the rider the delivery fee and the tip as separate lines', () => {
    const result = calculator.calculate({ deliveryFee: 100, tipAmount: 50 });

    expect(result.total).toBe(150);
    expect(result.components).toEqual([
      { type: DriverEarningType.DELIVERY_FEE, amount: 100, description: 'Delivery fee' },
      { type: DriverEarningType.TIP, amount: 50, description: 'Customer tip' },
    ]);
  });

  it('leaves out a line that is zero', () => {
    expect(calculator.calculate({ deliveryFee: 69, tipAmount: 0 }).components).toHaveLength(1);
    expect(calculator.calculate({ deliveryFee: 0, tipAmount: 30 }).components).toEqual([
      { type: DriverEarningType.TIP, amount: 30, description: 'Customer tip' },
    ]);
  });

  it('pays nothing on a free-delivery order without a tip', () => {
    const result = calculator.calculate({ deliveryFee: 0, tipAmount: 0 });

    expect(result.total).toBe(0);
    expect(result.components).toEqual([]);
  });

  it('rounds to the paisa', () => {
    expect(calculator.calculate({ deliveryFee: 68.999, tipAmount: 0.004 }).total).toBe(69);
  });
});

describe('EarningsCalculator.quote', () => {
  it('quotes the delivery fee and nothing else', () => {
    expect(new EarningsCalculator().quote(69)).toBe(69);
  });
});
