import { createSubject, Subject } from '../streams';
import { Emission, createOperator, Operator, Subscribable, Subscription } from '../abstractions';
import { Counter, catchAny, counter } from '../utils';
import { eventBus } from '../streams';

export const mergeMap = (project: (value: any) => Subscribable): Operator => {
  const output = createSubject();
  let activeInnerStreams: Subscribable[] = [];
  let processingPromises: Promise<void>[] = [];
  let emissionNumber = 0;
  const executionNumber: Counter = counter(0);
  let isFinalizing = false;
  let input: Subscribable | undefined;

  // Array to track active subscriptions for inner streams
  const subscriptions: Subscription[] = [];

  const init = (stream: Subscribable) => {
    input = stream;

    // Finalize when the input or output stream stops
    input.onStop.once(() => setTimeout(() => executionNumber.waitFor(emissionNumber).then(finalize), 0));
    output.onStop.once(finalize);
  };

  const handle = async (emission: Emission): Promise<Emission> => {
    emissionNumber++;

    // Process the emission asynchronously
    processEmission(emission, output);

    // Mark the emission as phantom and return immediately
    emission.isPhantom = true;
    return emission;
  };

  const processEmission = async (emission: Emission, stream: Subject): Promise<void> => {
    const [error, innerStream] = await catchAny(() => project(emission.value));

    if (error) {
      eventBus.enqueue({ target: output, payload: { error }, type: 'error' });
      executionNumber.increment();
      return;
    }

    activeInnerStreams.push(innerStream);

    const processingPromise = new Promise<void>((resolve) => {
      const promises: Set<Promise<void>> = new Set();

      const handleCompletion = async () => {
        await Promise.all(promises);
        executionNumber.increment();
        removeInnerStream(innerStream);

        processingPromises = processingPromises.filter((p) => p !== processingPromise);
        resolve();
      };

      const handleInnerEmission = (value: any) => {
        // Add promises from stream.next() to ensure parallel processing
        promises.add(stream.next(value));
      };

      // Handle errors for each inner stream independently
      innerStream.onError.once((error: any) => {
        eventBus.enqueue({ target: output, payload: { error }, type: 'error' });
        handleCompletion(); // Ensure this stream is marked complete
      });

      // Handle inner stream completion
      innerStream.onStop.once(() => {
        handleCompletion();
      });

      // Subscribe to inner stream emissions
      const subscription = innerStream.subscribe(handleInnerEmission);

      // Add the unsubscribe function to the subscriptions array
      subscriptions.push(subscription);
    });

    processingPromises.push(processingPromise);
  };

  const removeInnerStream = (innerStream: Subscribable) => {
    // Remove the unsubscribe function from the subscriptions array and unsubscribe
    const index = activeInnerStreams.indexOf(innerStream);
    if (index !== -1) {
      subscriptions[index].unsubscribe(); // Call the unsubscribe function
      activeInnerStreams.splice(index, 1);
      subscriptions.splice(index, 1); // Remove the unsubscribe function from the array
    }
  };

  const finalize = async () => {
    if (isFinalizing) { return; }
    isFinalizing = true;

    activeInnerStreams.forEach(stream => stream.isStopRequested = true);
    activeInnerStreams = [];
    stopInputStream();
    stopOutputStream();
  };

  const stopInputStream = () => {
    input!.isStopRequested = true;
  };

  const stopOutputStream = () => {
    output.isStopRequested = true;
  };

  const operator = createOperator(handle) as any;
  operator.name = 'mergeMap';
  operator.init = init;
  operator.stream = output;
  return operator;
};
