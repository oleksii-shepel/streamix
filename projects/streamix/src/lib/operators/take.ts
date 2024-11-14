import { createOperator, Operator, Stream, Subscribable } from '../abstractions';
import { Emission } from '../abstractions';

export const take = (count: number): Operator => {
  let emittedCount = 0;

  const handle = async (emission: Emission, stream: Subscribable): Promise<Emission> => {
    if (emittedCount < count) {
      emittedCount++;

      if (emittedCount === count) {
        stream.onComplete.once(() => {
          stream.isAutoComplete = true; // Mark the stream for auto completion
        })
      }
      return emission; // Return the emission if within count
    } else {
      emission.isPhantom = true; // Mark as phantom if beyond count
      return emission;
    }
  };

  const operator = createOperator(handle);
  operator.name = 'take';
  return operator;
};
