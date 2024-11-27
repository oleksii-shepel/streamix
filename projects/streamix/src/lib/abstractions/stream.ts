import { Operator, createPipeline, Pipeline, Subscription, Emission, Subscribable, isOperator, isReceiver, Receiver, createReceiver, hooks, SubscribableHooks, SubscribableInternals, internals, flags } from "../abstractions";
import { eventBus } from "../abstractions";
import { hook, Hook, awaitable } from "../utils";

export type Stream<T = any> = Subscribable<T> & {
  name?: string;
  operators: Operator[];
  emissionCounter: number;
  run: () => Promise<void>;

  [internals]: SubscribableInternals & {
    head: Operator | undefined;
    tail: Operator | undefined;
    bindOperators: (...operators: Operator[]) => Stream<T>;
    emit: (args: { emission: Emission; source: any }) => Promise<void>;
    awaitStart: () => Promise<void>;
  },

  [hooks]: SubscribableHooks & {
    subscribers: Hook;
  }
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

  const completion = awaitable<void>();
  const commencement = awaitable<void>();

  let autoComplete = false;
  let stopRequested = false;
  let stopped = false;
  let running = false;
  let currentValue: T | undefined;

  let emissionCounter = 0;

  const onStart = hook();
  const onComplete = hook();
  const onStop = hook();
  const onError = hook();
  const onEmission = hook();
  const subscribers = hook();

  const run = async () => {
    try {
      eventBus.enqueue({ target: stream, type: 'start' }); // Trigger start hook
      await onStart.waitForCompletion();
      commencement.resolve();
      await runFn.call(stream); // Pass the stream instance to the run function
      eventBus.enqueue({ target: stream, type: 'complete' }); // Trigger complete hook
      await onComplete.waitForCompletion();
    } catch (error) {
      eventBus.enqueue({ target: stream, payload: { error }, type: 'error' }); // Handle any errors
      await onError.waitForCompletion();
    } finally {
      eventBus.enqueue({ target: stream, type: 'stop' }); // Finalize the stop hook
      await onStop.waitForCompletion();
      stopped = true; running = false;
      operators.forEach(operator => operator.cleanup());
    }
  };

  const complete = async (): Promise<void> => {
    if(!stream[flags].isRunning && !stream[flags].isStopped) {
      await onStart.waitForCompletion();
    }

    if(!stream[flags].isStopped && !stream[flags].isAutoComplete) {
      stream[flags].isStopRequested = true;
      await onStop.waitForCompletion();
    }
  };

  const awaitStart = () => commencement.promise();
  const awaitCompletion = () => completion.promise();

  const bindOperators = function(...newOperators: Operator[]): Stream<T> {
    operators.length = 0;
    stream[internals].head = undefined;
    stream[internals].tail = undefined;

    newOperators.forEach((operator, index) => {
      operators.push(operator);

      if (!stream[internals].head) {
        stream[internals].head = operator;
      } else {
        stream[internals].tail!.next = operator;
      }
      stream[internals].tail = operator;

      if ('stream' in operator && index !== newOperators.length - 1) {
        throw new Error('Only the last operator in a stream can contain an outerStream property.');
      }
    });

    return stream;
  };

  const emit = async function({ emission, source }: { emission: Emission; source: any }): Promise<void> {
    try {

      let next = isStream(source) ? source[internals].head : undefined;
      next = isOperator(source) ? source.next : next;

      if (emission.failed) throw emission.error;

      if (!emission.phantom && !emission.pending) {
        emission = await (next?.process(emission, stream) ?? Promise.resolve(emission));
      }

      if (emission.failed) throw emission.error;

      if (!emission.phantom && !emission.pending) {
        await subscribers.parallel({ emission, source });
      }

      if (!emission.pending) {
        emission.complete = true;
        emission.resolve()
      }
    } catch (error) {
      emission.reject(error);
      eventBus.enqueue({ target: stream, payload: { error }, type: 'error' });
    }
  };

  const subscribe = (callbackOrReceiver?: ((value: T) => void) | Receiver<T>): Subscription => {
    // Convert a callback into a Receiver if needed
    const receiver = createReceiver(callbackOrReceiver);
    const errorCallback = ({ error }: any) => receiver.error!(error);

    // Chain the `complete` method to the `onStop` hook if present
    if (receiver.complete) {
      stream[hooks].onStop.chain(receiver, receiver.complete);
    }

    if (receiver.error) {
      stream[hooks].onError.chain(receiver, errorCallback);
    }

    // Define the bound callback for handling emissions
    const boundCallback = ({ emission, source }: any) => {
      currentValue = emission.value;

      try {
        if (emission.failed && receiver.error) {
          receiver.error(emission.error); // Call `error` if emission failed
        } else if (receiver.next) {
          receiver.next(emission.value); // Call `next` for successful emissions
        }
      } catch (err) {
        console.error('Error in Receiver callback:', err);
      }

      return Promise.resolve();
    };

    // Add the bound callback to the subscribers
    subscribers.chain(boundCallback);

    // Start the stream if it isn't running and stopping hasn't been requested
    if (!running && !stopRequested) {
      running = true;
      queueMicrotask(stream.run);
    }

    // Create the subscription object
    const subscription: Subscription = () => currentValue;
    subscription.unsubscribed = false;

    subscription.unsubscribe = () => {
      if (!subscription.unsubscribed) {
        stream[internals].complete().then(() => {
          if (receiver.complete) {
            stream[hooks].onStop.remove(receiver, receiver.complete);
          }

          if (receiver.error) {
            stream[hooks].onError.remove(receiver, errorCallback);
          }
          subscribers.remove(boundCallback);
        });
        subscription.unsubscribed = true;
      }
    };

    subscription.started = commencement.promise();
    subscription.completed = completion.promise();

    return subscription as Subscription;
  };

  const pipe = function(...operators: Operator[]): Pipeline<T> {
    return createPipeline<T>(stream)[internals].bindOperators(...operators);
  };

  const shouldComplete = () => autoComplete || stopRequested;

  const stream = {
    type: "stream" as "stream",
    operators,
    subscribe,
    pipe,
    run,
    emissionCounter,
    get value() {
      return currentValue;
    },

    [internals]: {
      head,
      tail,
      bindOperators,
      emit,
      awaitStart,
      awaitCompletion,
      complete,
      shouldComplete,
    },

    [hooks]: {
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
      }
    },

    [flags]: {
      get isAutoComplete() {
        return autoComplete;
      },
      set isAutoComplete(value: boolean) {
        if (value && completion.state() === 'pending') completion.resolve();
        autoComplete = value;
      },
      get isStopRequested() {
        return stopRequested;
      },
      set isStopRequested(value: boolean) {
        if (value && completion.state() === 'pending') completion.resolve();
        stopRequested = value;
      },
      get isRunning() {
        return running;
      },
      set isRunning(value: boolean) {
        running = value;
      },
      get isStopped() {
        return stopped;
      },
      set isStopped(value: boolean) {
        stopped = value;
      }
    }
  };

  stream[hooks].onEmission.chain(stream, stream[internals].emit);
  return stream; // Return the stream instance
}
