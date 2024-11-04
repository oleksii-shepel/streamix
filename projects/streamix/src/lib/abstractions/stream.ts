import { Operator, createPipeline, Pipeline, Subscription, Emission, Subscribable, pipe, isOperatorType as isOperator } from "../abstractions";
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
      await onStart.parallel(); // Trigger start hook
      await runFn.call(stream); // Pass the stream instance to the run function
      await onComplete.parallel(); // Trigger complete hook
    } catch (error) {
      await onError.parallel({ error }); // Handle any errors
    } finally {
      isStopped = true;
      isRunning = false;
      await onStop.parallel(); // Finalize the stop hook
    }
  };

  const complete = async (): Promise<void> => {
    if (!isAutoComplete) {
      isStopRequested = true;
      return new Promise<void>((resolve) => {
        onStop.once(() => resolve());
        completionPromise.resolve();
      });
    }
    return completionPromise.promise(); // Ensure the completion resolves correctly
  };

  const awaitCompletion = () => completionPromise.promise();

  const bindOperators = function(this: Stream<T>, ...newOperators: Operator[]): Stream<T> {
    this.operators.length = 0;
    this.head = undefined;
    this.tail = undefined;

    newOperators.forEach((operator, index) => {
      this.operators.push(operator);

      if (!this.head) {
        this.head = operator;
      } else {
        this.tail!.next = operator;
      }
      this.tail = operator;

      if ('stream' in operator && index !== newOperators.length - 1) {
        throw new Error('Only the last operator in a stream can contain an outerStream property.');
      }
    });

    return this;
  };

  const emit = async function(this: Stream<T>, { emission, source }: { emission: Emission; source: any }): Promise<void> {
    try {
      let next = isStream(source) ? this.head : undefined;
      next = isOperator(source) ? source.next : next;

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        emission = await (next?.process(emission, this) ?? Promise.resolve(emission));
      }

      if (emission.isFailed) throw emission.error;

      if (!emission.isPhantom) {
        await this.subscribers.parallel({ emission, source });
      }

      emission.isComplete = true;
    } catch (error) {
      emission.isFailed = true;
      emission.error = error;
      await this.onError.parallel({ error });
    }
  };

  const subscribe = (callback?: (value: T) => void): Subscription => {
    const boundCallback = ({ emission, source }: any) => {
      currentValue = emission.value;
      return callback ? Promise.resolve(callback(emission.value)) : Promise.resolve();
    };

    onEmission.chain(boundCallback);

    if (!isRunning) {
      isRunning = true;
      queueMicrotask(run);
    }

    const value: any = () => currentValue;
    value.unsubscribe = async () => {
      await complete();
      onEmission.remove(boundCallback);
    };

    return value;
  };

  const pipe = function(this: Stream<T>, ...operators: Operator[]): Pipeline<T> {
    return createPipeline<T>(this).bindOperators(...operators);
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
