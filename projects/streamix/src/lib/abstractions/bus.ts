import { createLock, createSemaphore, createQueue, Queue } from '../utils';
import { createEmission, Emission } from './emission';
import { flags, hooks } from './subscribable';

export const eventBus = createBus() as Bus;

(async function startEventBus() {
  for await (const event of eventBus.run()) {
  }
})();


export type BusEvent = {
  target: any;
  type: 'emission' | 'start' | 'finalize' | 'complete' | 'error';
  payload?: any;
  timeStamp?: Date;
};

export function isBusEvent(obj: any): obj is BusEvent {
  return (
    obj &&
    typeof obj === 'object' &&
    'target' in obj &&
    'type' in obj &&
    typeof obj.type === 'string'
  );
}

export type Bus = {
  run(): AsyncGenerator<BusEvent>;
  enqueue(event: BusEvent): void;
  name?: string;
};

export function createBus(config?: {bufferSize?: number, harmonize?: boolean}): Bus {

  const bufferSize = config?.bufferSize || 64; // Adjust buffer size as needed

  const buffer: Array<BusEvent | null> = new Array(bufferSize).fill(null);
  const pendingEmissions: Map<any, Set<Emission>> = new Map();
  const finalizeMarkers: Map<any, any> = new Map();
  const completeMarkers: Map<any, any> = new Map();

  let head = 0;
  let tail = 0;

  const lock = createLock();
  const itemsAvailable = createSemaphore(0); // Semaphore for items available in the buffer
  const spaceAvailable = createSemaphore(bufferSize); // Semaphore for available space in the buffer

  const bus: Bus = {
    async * run(): AsyncGenerator<BusEvent> {
      async function* trackPendingEmission(target: any, emission: Emission) {
        const pendingSet = pendingEmissions.get(target) || new Set();
        if (!pendingSet.has(emission)) {
          pendingSet.add(emission);
          pendingEmissions.set(target, pendingSet);
        }

        const eventQueue = createQueue<BusEvent>();
        const addToQueue = (event: BusEvent) => eventQueue.enqueue(event);

        // Process the emission asynchronously in a microtask
        emission.wait().then(async () => {
          pendingSet.delete(emission);

          if (pendingSet.size === 0) {
            pendingEmissions.delete(target);

            if (completeMarkers.has(target)) {
              const payload = completeMarkers.get(target);
              completeMarkers.delete(target);
              const completeEvents = (await target[hooks].onComplete.parallel(payload)).filter(
                (fn: any) => fn instanceof Function
              );

              for (const event of completeEvents) {
                for await (const busEvent of processEvent(event())) {
                  addToQueue(busEvent);
                }
              }
            }

            if (finalizeMarkers.has(target)) {
              const payload = finalizeMarkers.get(target);
              finalizeMarkers.delete(target);
              const finalizeEvents = (await target[hooks].finalize.parallel(payload)).filter(
                (fn: any) => fn instanceof Function
              );

              for (const event of finalizeEvents) {
                for await (const busEvent of processEvent(event())) {
                  addToQueue(busEvent);
                }
              }
            }
          }
        });

        while (true) {
          const event = await eventQueue.dequeue();
          yield event;
        }
      }

      async function* processEvent(event: BusEvent): AsyncGenerator<BusEvent> {
        yield event;

        switch (event.type) {
          case 'start':
            const emissionEvents = (await event.target[hooks].onStart.parallel(event.payload)).filter((fn: any) => fn instanceof Function);
            for (const emissionEvent of emissionEvents) {
              yield* await processEvent(emissionEvent());
            }
            break;
          case 'finalize':
            if (!pendingEmissions.has(event.target)) {
              const emissionEvents = (await event.target[hooks].finalize.parallel(event.payload)).filter((fn: any) => fn instanceof Function);
              for (const emissionEvent of emissionEvents) {
                yield* await processEvent(emissionEvent());
              }
            } else {
              finalizeMarkers.set(event.target, event.payload);
            }
            break;
          case 'emission':
            let emission = event.payload?.emission ?? createEmission({});
            const target = event.target;

            if (target[flags].isStopRequested && completeMarkers.has(target)) {
              emission.phantom = true;
              emission.ancestor?.finalize();
            } else {
              const emissionEvents = (await target[hooks].onEmission.parallel(event.payload)).filter((fn: any) => fn instanceof Function);
              for (const emissionEvent of emissionEvents) {
                yield* await processEvent(emissionEvent());
              }
            }

            if (emission.pending) {
              yield* await trackPendingEmission(target, emission);
            }
            break;
          case 'complete':
            if (!pendingEmissions.has(event.target)) {
              const completeEvents = (await event.target[hooks].onComplete.parallel(event.payload)).filter((fn: any) => fn instanceof Function);
              for (const completeEvent of completeEvents) {
                yield* await processEvent(completeEvent());
              }
            } else {
              completeMarkers.set(event.target, event.payload);
            }
            break;
          case 'error':
            const errorEvents = (await event.target[hooks].onError.parallel(event.payload)).filter((fn: any) => fn instanceof Function);
            for (const errorEvent of errorEvents) {
              yield* await processEvent(errorEvent());
            }
            break;
        }
      }

      while (true) {

        await itemsAvailable.acquire();

        const event = buffer[head];
        if (event) {
          // Process the current event
          for await (const current of processEvent(event)) {
            yield current;
          }

          // Move head forward in the buffer and release space
          head = (head + 1) % bufferSize;
          spaceAvailable.release();
        }
      }
    },

    async enqueue(event: BusEvent): Promise<void> {
      const releaseLock = await lock.acquire();

      try {
        await spaceAvailable.acquire(); // Wait until space is available in the buffer
        event.timeStamp = new Date(); // Add timestamp for the event

        // Place the event into the buffer and update the tail position
        buffer[tail] = event;
        tail = (tail + 1) % bufferSize;

        // Release the semaphore to notify the consumer that an item is available
        itemsAvailable.release();
      } finally {
        releaseLock(); // Always release the lock to avoid blocking other operations
      }
    },
  };

  bus.name = 'bus';
  return bus;
}
