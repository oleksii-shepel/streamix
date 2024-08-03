import { CatchErrorOperator, EndWithOperator, FinalizeOperator, StartWithOperator } from '../hooks';
import { ReduceOperator } from '../operators';
import { promisified } from '../utils';
import { Emission } from './emission';
import { hook } from './hook';
import { Operator } from './operator';
import { Subscription } from './subscription';

export class Stream<T = any> {

  isAutoComplete = promisified<boolean>(false);
  isCancelled = promisified<boolean>(false);
  isStopRequested = promisified<boolean>(false);

  isFailed = promisified<any>(undefined);
  isStopped = promisified<boolean>(false);
  isUnsubscribed = promisified<boolean>(false);
  isRunning = promisified<boolean>(false);

  subscribers: (((value: T) => any) | void)[] = [];

  onStart = hook();
  onComplete = hook();
  onStop = hook();
  onError = hook();

  run(): Promise<void> {
    throw new Error('Method is not implemented.');
  }

  shouldTerminate() {
    return this.isCancelled() || this.isFailed();
  }

  awaitTermination() {
    return promisified.race([this.isCancelled, this.isFailed]);
  }

  terminate(): Promise<void> {
    this.isCancelled.resolve(true);
    return this.isStopped.then(() => Promise.resolve());
  }

  shouldComplete() {
    return this.isAutoComplete() || this.isUnsubscribed() || this.isStopRequested();
  }

  awaitCompletion() {
    return promisified.race([this.isAutoComplete, this.isUnsubscribed, this.isStopRequested]);
  }

  complete(): Promise<void> {
    this.isStopRequested.resolve(true);
    return this.isRunning() ? this.isStopped.then(() => Promise.resolve()) : Promise.resolve();
  }

  unsubscribe(callback: (value: T) => any): void {
    this.subscribers = this.subscribers.filter(subscriber => subscriber !== callback);
    if (this.subscribers.length === 0) {
      this.isStopRequested.resolve(true);
      this.isUnsubscribed.resolve(true);
    }
  }

  subscribe(callback: void | ((value: T) => any)): Subscription {
    const boundCallback = callback ?? (() => {});
    this.subscribers.push(boundCallback);

    if (this.subscribers.length === 1 && this.isRunning() === false) {
      this.isRunning.resolve(true);

      // Queue microtask to ensure parent subscription happens before running the logic
      queueMicrotask(async () => {
        try {
          // Use a macrotask to subscribe to the parent stream after the child stream has started running
          if (this.parent) {
            setTimeout(() => {
              this.parent.subscribe();
            }, 0);
          }
          
          // Emit start value if defined
          await this.onStart?.process({ stream: this });

          // Start the actual stream logic without waiting for it to complete
          await this.run();

          // Emit end value if defined
          await this.onComplete?.process({ stream: this });
        } catch (error) {
          // Handle error if catchError defined
          await this.onError?.process({ stream: this, error });
          if (this.onError === undefined) {
            this.isFailed.resolve(error);
          }
        } finally {
          // Handle finalize callback
          await this.onStop?.process({ stream: this });

          this.isStopped.resolve(true);
          this.isRunning.reset();
        }
      });
    }

    return {
      unsubscribe: () => {
        if (boundCallback instanceof Function) {
          this.unsubscribe(boundCallback);
        }
        // Unsubscribe from the parent stream
        if (this.parent) {
          this.parent.unsubscribe(boundCallback);
        }
      }
    };
  }

  parent: Stream<T> | undefined = undefined;

  head: Operator | undefined = undefined;
  tail: Operator | undefined = undefined;

  pipe(...operators: Operator[]): Stream<T> {
    let currentStream = this as Stream<T>;
    for (const operator of operators) {
      if (operator instanceof Operator) {
        if (!currentStream.head) {
          currentStream.head = operator;
          currentStream.tail = operator;
        } else {
          currentStream.tail!.next = operator;
          currentStream.tail = operator;
        }

        if ('outerStream' in operator && operator.outerStream instanceof Stream) {
          operator.outerStream.parent = currentStream;
          currentStream = operator.outerStream as Stream<T>;
        }
      }

      if (operator instanceof StartWithOperator) {
        this.onStart.chain(operator.callback.bind(operator));
      } else if (operator instanceof EndWithOperator) {
        this.onComplete.chain(operator.callback.bind(operator));
      } else if (operator instanceof CatchErrorOperator) {
        this.onError.chain(operator.callback.bind(operator));
      } else if (operator instanceof FinalizeOperator) {
        this.onStop.chain(operator.callback.bind(operator));
      } else if (operator instanceof ReduceOperator) {
        this.onComplete.chain(operator.callback.bind(operator));
      }
    }
    return currentStream;
  }
  
  combine(operator: Operator, stream: Stream<T>) {
    return stream;
  }
  
  async emit(emission: Emission, next: Operator): Promise<void> {
    try {
      let currentEmission: Emission = emission;

      if (this.isCancelled()) {
        currentEmission.isCancelled = true;
      }

      currentEmission = await (next?.process(currentEmission, this) ?? Promise.resolve(currentEmission));

      if (!(currentEmission.isPhantom || currentEmission.isCancelled || currentEmission.isFailed)) {
        await Promise.all(this.subscribers.map((subscriber) => (subscriber instanceof Function) ? subscriber(currentEmission.value) : Promise.resolve()));
      }

      currentEmission.isComplete = true;
    } catch (error: any) {
      console.warn(`Error in stream ${this.constructor.name}: `, error);
      emission.isFailed = true;
      emission.error = error;
    }
  }
}
