import { distanceFee, type DeliveryFeeRules } from './delivery-fee.policy';

const RULES: DeliveryFeeRules = { perKmFee: 50, minFee: 50, maxFee: 150, maxDistanceKm: 3 };

describe('distanceFee', () => {
  it('charges by the kilometre', () => {
    expect(distanceFee(1.5, RULES)).toBe(75);
    expect(distanceFee(2.4, RULES)).toBe(120);
  });

  it('never charges less than the minimum, however short the run', () => {
    expect(distanceFee(0, RULES)).toBe(50);
    expect(distanceFee(0.3, RULES)).toBe(50);
  });

  it('reaches the maximum fee at the maximum distance', () => {
    expect(distanceFee(3, RULES)).toBe(150);
  });

  it('never charges more than the maximum, whatever the rate', () => {
    expect(distanceFee(2.9, { ...RULES, perKmFee: 90 })).toBe(150);
  });

  it('keeps to the maximum even when the minimum is set above it', () => {
    expect(distanceFee(1, { ...RULES, minFee: 200 })).toBe(150);
  });

  it('does not deliver beyond the maximum distance', () => {
    expect(distanceFee(3.01, RULES)).toBeNull();
  });

  it('charges whole rupees', () => {
    expect(distanceFee(1.234, RULES)).toBe(62);
  });
});
