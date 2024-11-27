import { flags } from './../abstractions/subscribable';
import { createOperator, Emission, hooks, internals, Operator, Stream, Subscribable, Subscription } from '../abstractions';
import { awaitable } from '../utils';

export const withLatestFrom = (...streams: Subscribable[]): Operator => {
  // Use `awaitable` for storing the latest values from streams
  let latestValues = streams.map(() => awaitable<any>());
  let subscriptions: Subscription[] = [];

  // Initialize the operator and set up the subscription-based handling
  const init = (stream: Stream) => {
    // Override the `run` method to start other streams
    const originalRun = stream.run;

    stream.run = async () => {
      // Subscribe to other streams and collect their latest values
      streams.forEach((source, index) => {
        const latestValue = latestValues[index];

        // Subscribe to each source stream
        const subscription = source.subscribe(value => latestValue.resolve(value));

        // Store each subscription for later cleanup
        subscriptions.push(subscription);

        // Wait until each subscription is started
        subscription.started?.then(() => console.log(`Stream ${index} started`));
      });

      // Wait until all streams are started before running the main stream
      await Promise.all(subscriptions.map(sub => sub.started));
      await originalRun.call(stream);
    };

    // Cleanup on stream termination
    stream[hooks].onStop.once(finalize);
  };

  // Cleanup all subscriptions
  const finalize = async () => {
    await Promise.all(subscriptions.map(sub => sub.unsubscribe()));
    latestValues = [];
    subscriptions = [];
  };

  // Handle emissions by combining the latest values from all streams
  const handle = async (emission: Emission, stream: Subscribable): Promise<Emission> => {
    if (stream[internals].shouldComplete()) {
      await Promise.all(streams.map(source => source[flags].isStopRequested = true));
    }

    // Wait for all latest values to be available
    const latestValuesPromise = Promise.all(latestValues.map((value) => value()));

    // Monitor for any stream or main stream completion
    const terminationPromises = Promise.race([
      stream[internals].awaitCompletion(),
      ...streams.map(source => source[internals].awaitCompletion()),
    ]);

    await Promise.race([latestValuesPromise, terminationPromises]);

    // Update the emission with the latest values
    if (latestValues.every((value) => value.state() === 'fullfilled')) {
      emission.value = [emission.value, ...latestValues.map(value => value())];
    } else {
      emission.failed = true;
      emission.error = new Error("Some streams are completed without emitting value.");
      finalize();
    }
    return emission;
  };

  // Create and return the operator
  const operator = createOperator(handle);
  operator.name = 'withLatestFrom';
  operator.init = init;
  return operator;
};
