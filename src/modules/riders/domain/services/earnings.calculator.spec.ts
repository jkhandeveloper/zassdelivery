import { DriverEarningType } from '@prisma/client';

import { EarningsCalculator, type EarningRates } from './earnings.calculator';

const RATES: EarningRates = {
  baseFare: 60,
  perKm: 18,
  tipSharePercentage: 100,
  minimumFare: 80,
};

describe('EarningsCalculator.calculate', () => {
  const calculator = new EarningsCalculator();

  it('pays the base fare plus the distance component', () => {
    const result = calculator.calculate({ distanceKm: 2.5, tipAmount: 0 }, RATES);

    expect(result.total).toBe(105);
    expect(result.components).toEqual([
      { type: DriverEarningType.BASE_FARE, amount: 60, description: 'Base fare' },
      {
        type: DriverEarningType.DISTANCE,
        amount: 45,
        description: 'Distance — 2.5 km at Rs. 18/km',
      },
    ]);
  });

  it('itemises the components rather than returning one figure', () => {
    const result = calculator.calculate({ distanceKm: 3, tipAmount: 50 }, RATES);

    expect(result.components.map((component) => component.type)).toEqual([
      DriverEarningType.BASE_FARE,
      DriverEarningType.DISTANCE,
      DriverEarningType.TIP,
    ]);
  });

  it('tops a short run up to the minimum fare', () => {
    const result = calculator.calculate({ distanceKm: 0.5, tipAmount: 0 }, RATES);

    // 60 + 9 = 69, topped up by 11 to reach the 80 floor.
    expect(result.total).toBe(80);
    expect(result.components.at(-1)).toEqual({
      type: DriverEarningType.ADJUSTMENT,
      amount: 11,
      description: 'Minimum fare top-up to Rs. 80',
    });
  });

  it('leaves a run above the floor untouched', () => {
    const result = calculator.calculate({ distanceKm: 4, tipAmount: 0 }, RATES);

    expect(result.components.some((c) => c.type === DriverEarningType.ADJUSTMENT)).toBe(false);
  });

  it('passes the whole tip through at a 100% share', () => {
    const result = calculator.calculate({ distanceKm: 2, tipAmount: 100 }, RATES);

    expect(result.components.at(-1)).toEqual({
      type: DriverEarningType.TIP,
      amount: 100,
      description: 'Customer tip',
    });
  });

  it('applies a partial tip share when the platform keeps a cut', () => {
    const result = calculator.calculate(
      { distanceKm: 2, tipAmount: 100 },
      { ...RATES, tipSharePercentage: 80 },
    );

    expect(result.components.at(-1)?.amount).toBe(80);
  });

  it('omits the tip line entirely when there is no tip', () => {
    const result = calculator.calculate({ distanceKm: 2, tipAmount: 0 }, RATES);

    expect(result.components.some((c) => c.type === DriverEarningType.TIP)).toBe(false);
  });

  it('treats an unknown distance as zero rather than failing', () => {
    const result = calculator.calculate({ distanceKm: null, tipAmount: 0 }, RATES);

    expect(result.total).toBe(80);
    expect(result.components.some((c) => c.type === DriverEarningType.DISTANCE)).toBe(false);
  });

  it('rounds money to two decimals', () => {
    const result = calculator.calculate({ distanceKm: 2.333, tipAmount: 0 }, RATES);

    expect(result.total).toBe(Math.round(result.total * 100) / 100);
    expect(result.components[1]?.amount).toBe(41.99);
  });

  it('never returns less than the minimum fare, whatever the rates', () => {
    const result = calculator.calculate(
      { distanceKm: 0, tipAmount: 0 },
      { baseFare: 0, perKm: 0, tipSharePercentage: 0, minimumFare: 80 },
    );

    expect(result.total).toBe(80);
  });
});

describe('EarningsCalculator.quote', () => {
  const calculator = new EarningsCalculator();

  it('quotes the fare a rider is offered', () => {
    expect(calculator.quote(2.5, RATES)).toBe(105);
  });

  it('leaves the tip out of the quote, since it can still change', () => {
    const quoted = calculator.quote(2.5, RATES);
    const actual = calculator.calculate({ distanceKm: 2.5, tipAmount: 200 }, RATES);

    expect(quoted).toBe(105);
    expect(actual.total).toBe(305);
  });
});
