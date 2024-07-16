import { AbstractStream, scan } from '../lib';

// Mock implementation for AbstractStream
class MockStream extends AbstractStream {
  private values: any[];
  private index: number;

  constructor(values: any[]) {
    super();
    this.values = values;
    this.index = 0;
  }

  override async run(): Promise<void> {
    try {
      while (this.index < this.values.length && !this.isStopRequested.value) {
        await this.emit({ value: this.values[this.index] });
        this.index++;
      }
      this.isAutoComplete.resolve(true);
    } catch (error) {
      console.error('Error in MockStream:', error);
    } finally {
      this.isStopped.resolve(true);
    }
  }
}

describe('scan operator', () => {
  it('should accumulate values correctly', (done) => {
    const testStream = new MockStream([1, 2, 3]);
    const accumulator = (acc: number, value: number) => acc + value;
    const seed = 0;

    const scannedStream = testStream.pipe(scan(accumulator, seed));

    let results: any[] = [];

    scannedStream.subscribe((value) => {
      results.push(value);
    });

    scannedStream.isStopped.promise.then(() => {
      expect(results).toEqual([1, 3, 6]);
      done();
    });
  });

  it('should handle errors in accumulation', (done) => {
    const testStream = new MockStream([1, 2, 3]);
    const accumulator = (acc: number, value: number) => {
      if (value === 2) {
        throw new Error('Error in accumulation');
      }
      return acc + value;
    };
    const seed = 0;

    const scannedStream = testStream.pipe(scan(accumulator, seed));

    let results: any[] = [];

    scannedStream.subscribe((value) => {
      results.push(value);
    });

    scannedStream.isStopped.promise.then(() => {
      expect(results).toEqual([1]); // Only the first value should be accumulated before error
      done();
    });
  });
});