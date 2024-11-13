import { Operator, createPipeline, Pipeline, Subscription, Emission, Subscribable, pipe, isOperatorType as isOperator } from "../abstractions";
import { eventBus } from "../../lib";
import { hook, HookType, promisified } from "../utils";

export type Stream<T = any> = Subscribable<T> & {
  operators: Operator[];
  head: Operator | undefined;
  tail: Operator | undefined;
  bindOperators: (...operators: Operator[]) => Stream<T>;
  emit: (args: { emission: Emission; source: any }) => Promise<void>;
  run: () => Promise<void>; // Run stream logic
  name?: string;
  subscribers: HookType;
};

export function isStream<T>(obj: any): obj is Stream<T> {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.run === 'function'
  );
}

export function createStream<T = any>(runFn: (this: Stream<T>, params?: any) => Promise<void>): Stream<T> {
  const operators: Operator[] = [];
  let head: Operator | undefined;
  let tail: Operator | undefined;

  const completionPromise = promisified<void>();

  let isAutoComplete = false;
  let isStopRequested = false;
  let isStopped = false;
  let isRunning = false;
  let currentValue: T | undefined;

  const onStart = hook();
  const onComplete = hook();
  const onStop = hook();
  const onError = hook();
  const onEmission = hook();
  const subscribers = hook();

  const run = async () => {
    try {
      eventBus.enqueue({ target: stream, type: 'start' }); // Trigger start hook
      await runFn.call(stream); // Pass the stream instance to the run function
      eventBus.enqueue({ target: stream, type: 'complete' }); // Trigger complete hook
    } catch (error) {
      eventBus.enqueue({ target: stream, payload: { error }, type: 'error' }); // Handle any errors
    } finally {
      isStopped = true; isRunning = false;
      eventBus.enqueue({ target: stream, type: 'stop' }); // Finalize the stop hook
    }
  };

  const complete = async (): Promise<void> => {
    if (!isAutoComplete) {
      isStopRequested = true;
    }

    return new Promise<void>((resolve) => {
      onStop.once(() => { operators.forEach(operator => operator.cleanup()); resolve(); });
      completionPromise.resolve();
    });
  };

  const awaitCompletion = () => completionPromise.promise();

  const bindOperators = function(...newOperators: Operator[]): Stream<T> {
    operators.length = 0;
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
        throw new Error('Only the last operator in a stream can contain an outerStream property.');
      }
    });

    return stream;
  };

  const emit = async function({ emission, source }: { emission: Emission; source: any }): Promise<void> {
    try {
      let next = isStream(source) ? head : undefined;
      next = isOperator(source) ? source.next : next;

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        emission = await (next?.process(emission, stream) ?? Promise.resolve(emission));
      }

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        await subscribers.parallel({ emission, source });
      }

      emission.isComplete = true;
    } catch (error) {
      emission.isFailed = true;
      emission.error = error;
      eventBus.enqueue({ target: stream, payload: { error }, type: 'error' });
    }
  };

  const subscribe = (callback?: (value: T) => void): Subscription => {
    const boundCallback = ({ emission, source }: any) => {
      currentValue = emission.value;
      return callback ? Promise.resolve(callback(emission.value)) : Promise.resolve();
    };

    subscribers.chain(boundCallback);

    if (!isRunning) {
      isRunning = true;
      queueMicrotask(run);
    }

    const value: any = () => currentValue;
    value.unsubscribe = async () => {
      await complete();
      subscribers.remove(boundCallback);
    };

    return value;
  };

  const pipe = function(...operators: Operator[]): Pipeline<T> {
    return createPipeline<T>(stream).bindOperators(...operators);
  };

  const shouldComplete = () => isAutoComplete || isStopRequested;

  const stream = {
    type: "stream" as "stream",
    operators,
    head,
    tail,
    bindOperators,
    emit,
    subscribe,
    pipe,
    run,
    awaitCompletion,
    complete,
    shouldComplete,
    get value() {
      return currentValue;
    },
    get onStart() {
      return onStart;
    },
    get onComplete() {
      return onComplete;
    },
    get onStop() {
      return onStop;
    },
    get onError() {
      return onError;
    },
    get onEmission() {
      return onEmission;
    },
    get subscribers() {
      return subscribers;
    },
    get isAutoComplete() {
      return isAutoComplete;
    },
    set isAutoComplete(value: boolean) {
      if (value) completionPromise.resolve();
      isAutoComplete = value;
    },
    get isStopRequested() {
      return isStopRequested;
    },
    set isStopRequested(value: boolean) {
      if (value) completionPromise.resolve();
      isStopRequested = value;
    },
    get isRunning() {
      return isRunning;
    },
    get isStopped() {
      return isStopped;
    }
  };

  stream.onEmission.chain(stream, stream.emit);
  return stream; // Return the stream instance
}
