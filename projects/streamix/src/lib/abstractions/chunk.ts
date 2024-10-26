import { createPipeline, isStream, Stream, Subscription } from '../abstractions';
import { hook } from '../utils';
import { Emission } from './emission';
import { isOperatorType as isOperator, Operator } from '../abstractions';
import { Subscribable } from './subscribable';

export type Chunk<T = any> = Subscribable<T> & {
  stream: Stream<T>;
  emit: (args: { emission: Emission; source: any }) => Promise<void>;
  bindOperators(...operators: Operator[]): Chunk<T>; // Method to bind operators
};

// Function to create a Chunk
export function createChunk<T = any>(stream: Stream<T>): Chunk<T> {
  let operators: Operator[] = [];
  let head: Operator | undefined;
  let tail: Operator | undefined;
  let currentValue: T | undefined;

  const onEmission = hook();
  const subscribers = hook();

  const initEmissionChain = () => {
    if (!stream.onEmission.contains(emit)) {
      stream.onEmission.chain(emit);
    }
  };

  const emit = async ({ emission, source }: { emission: Emission; source: any }): Promise<void> => {
    try {
      let next = isStream(source) ? head : undefined;
      next = isOperator(source) ? source.next : next;

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        emission = await (next?.process(emission, chunk) ?? Promise.resolve(emission));
      }

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        await onEmission.parallel({ emission, source: stream });
        await subscribers.parallel(emission.value);
      }

      emission.isComplete = true;
    } catch (error: any) {
      emission.isFailed = true;
      emission.error = error;
      await stream.onError.process({ error });
    }
  };

  const bindOperators = (...newOperators: Operator[]): Chunk<T> => {
    operators = [];
    head = undefined;
    tail = undefined;

    newOperators.forEach((operator, index) => {
      operators.push(operator);

      if (!head) {
        head = operator;
      } else {
        tail!.next = operator;
      }
      tail = operator;

      if ('stream' in operator && index !== newOperators.length - 1) {
        throw new Error('Only the last operator in a chunk can contain an outerStream property.');
      }
    });

    return chunk;
  };

  const subscribe = (callback?: (value: T) => void): Subscription => {
    const boundCallback = (value: T) => {
      currentValue = value;
      return callback ? Promise.resolve(callback(value)) : Promise.resolve();
    };

    subscribers.chain(boundCallback);
    stream.start();

    const value: any = () => currentValue;
    value.unsubscribe = async () => {
      subscribers.remove(boundCallback);
      if (subscribers.length === 0) {
        await stream.complete();
      }
    };

    return value;
  };

  const chunk: Chunk<T> = {
    type: "chunk" as "chunk",
    stream,
    bindOperators,
    subscribe,
    start: () => stream.start(),
    emit,
    pipe: (...newOperators: Operator[]) => createPipeline<T>(stream).pipe(...operators, ...newOperators),
    shouldComplete: () => stream.shouldComplete(),
    awaitCompletion: () => stream.awaitCompletion(),
    complete: () => stream.complete(),
    get value() {
      return currentValue;
    },
    get subscribers() {
      return subscribers;
    },
    get onStart() {
      return stream.onStart;
    },
    get onComplete() {
      return stream.onComplete;
    },
    get onStop() {
      return stream.onStop;
    },
    get onError() {
      return stream.onError;
    },
    get onEmission() {
      return onEmission;
    },
    get isAutoComplete() {
      return stream.isAutoComplete;
    },
    set isAutoComplete(value: boolean) {
      stream.isAutoComplete = value;
    },
    get isStopRequested() {
      return stream.isStopRequested;
    },
    set isStopRequested(value: boolean) {
      stream.isStopRequested = value;
    },
    get isRunning() {
      return stream.isRunning;
    },
    get isStopped() {
      return stream.isStopped;
    }
  };

  initEmissionChain(); // Initialize emission chain to capture emissions from the stream.

  return chunk;
}
