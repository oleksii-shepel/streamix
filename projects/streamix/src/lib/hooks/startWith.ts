import { createStreamOperator, Stream, StreamOperator } from '../abstractions';
import { createSubject } from '../streams';

export const startWith = (value: any): StreamOperator => {
  const operator = (input: Stream): Stream => {
    const output = createSubject<any>(); // Create the output stream

    // Subscribe to the original stream
    (async () => {
      try {
        // Emit the value at the start of the stream
        output.next(value);

        // Iterate over the input stream asynchronously
        for await (const emission of input) {
          output.next(emission.value); // Forward emissions from the original stream
        }
      } catch (err) {
        output.error(err);
      } finally {
        // Complete the output stream once the original stream completes
        output.complete();
      }
    })();

    return output;
  };

  return createStreamOperator('startWith', operator);
};
