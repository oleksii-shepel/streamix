import { timer } from '../lib';

describe('TimerStream', () => {
  it('should emit values at specified interval', async () => {
    const intervalMs = 100;
    const timerStream = timer(0, intervalMs);

    const emittedValues: number[] = [];
    timerStream.subscribe({
      next: (value) => emittedValues.push(value),
      complete: () => {
        // Check that values are emitted at approximately the correct interval
        expect(emittedValues.length).toBeGreaterThan(1);
        for (let i = 1; i < emittedValues.length; i++) {
          const timeDiff = emittedValues[i] - emittedValues[i - 1];
          expect(timeDiff).toBeGreaterThanOrEqual(intervalMs - 10); // Allow for slight timing variations
          expect(timeDiff).toBeLessThanOrEqual(intervalMs + 10);
        }
      }
    });
  });

  it('should stop emitting after unsubscribe', async () => {
    const intervalMs = 100;
    const timerStream = timer(0, intervalMs);

    const emittedValues: number[] = [];
    const subscription = timerStream.subscribe((value) => {
      emittedValues.push(value);
    });

    subscription.unsubscribe();

    const previousLength = emittedValues.length;
    await new Promise((resolve) => setTimeout(resolve, intervalMs * 2)); // Wait for potential additional emissions

    expect(emittedValues.length).toBe(previousLength); // No new emissions should occur after unsubscribe
  });
});
