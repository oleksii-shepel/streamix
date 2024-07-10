import { AbstractStream, filter } from '../lib';

describe('FilterOperator', () => {
  it('should allow values that pass the predicate', (done) => {
    const testStream = new TestStream([1, 2, 3, 4, 5]);
    const predicate = (value: number) => value % 2 === 0; // Allow only even numbers

    const filteredStream = testStream.pipe(filter(predicate));

    let didEmit = false;

    filteredStream.subscribe((value) => {
      didEmit = true;
      console.log(value);
      expect(value).toBeGreaterThanOrEqual(2); // Only even numbers should be emitted
    });

    filteredStream.isStopped.promise.then(() => {});

    // Manually check for completion after a timeout
    setTimeout(() => {
      if (!didEmit) {
        done(new Error('No values emitted'));
      } else {
        done();
      }
    }, 100); // Adjust timeout based on your test stream implementation
  });

  it('should not emit values that fail the predicate', (done) => {
    const testStream = new TestStream([1, 2, 3]);
    const predicate = (value: number) => value > 3; // Allow only values greater than 3

    const filteredStream = testStream.pipe(filter(predicate));

    let didEmit = false;

    filteredStream.subscribe((value) => {
      didEmit = true;
      done(new Error('Unexpected value emitted'));
    });

    // Manually check for completion after a timeout
    setTimeout(() => {
      if (didEmit) {
        done(new Error('Should not emit if no values pass the predicate'));
      } else {
        done();
      }
    }, 100); // Adjust timeout based on your test stream implementation
  });

  it('should emit all allowed values before stopping', (done) => {
    const testStream = new TestStream([1, 2, 3, 4, 5]);
    const predicate = (value: number) => value <= 3; // Allow values less than or equal to 3

    let count = 0;

    const filteredStream = testStream.pipe(filter(predicate));

    filteredStream.subscribe((value) => {
      count++;
    });

    // Manually check for completion and expected number of emissions after a timeout
    setTimeout(() => {
      if (count === 3) {
        done();
      } else {
        done(new Error('Did not emit all allowed values or stopped prematurely'));
      }
    }, 100); // Adjust timeout based on your test stream implementation
  });
});

// Assuming you have a TestStream implementation for testing purposes
class TestStream extends AbstractStream {
  private index: number;
  private values: any[];

  constructor(values: any[]) {
    super();
    this.index = 0;
    this.values = values;
  }

  async run(): Promise<void> {
    try {
      while (this.index < this.values.length && !this.isStopRequested) {
        await this.emit({ value: this.values[this.index] });
        this.index++;
      }
      this.isAutoComplete = true;
    } catch (error) {
      console.error('Error in TestStream:', error);
      // Handle errors appropriately in your testing environment
    } finally {
      this.isStopped.resolve(true);
    }
  }
}