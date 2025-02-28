import {
  createEmission,
  createStreamOperator,
  Stream,
  StreamOperator,
} from '../abstractions';
import { createSubject, Subject } from '../streams';

export type Coroutine = StreamOperator & {
  finalize: () => Promise<void>;
  processTask: (data: any) => Promise<any>;
  getIdleWorker: () => Promise<Worker>;
  returnWorker: (worker: Worker) => void;
};

export const coroutine = (...functions: Function[]): Coroutine => {
  if (functions.length === 0) {
    throw new Error('At least one function (the main task) is required.');
  }

  const maxWorkers = navigator.hardwareConcurrency || 4;
  const workerPool: Worker[] = [];
  const workerQueue: Array<(worker: Worker) => void> = [];
  let isFinalizing = false;
  let createdWorkersCount = 0;

  let helperScriptCache: string | null = null;
  let fetchingHelperScript = false;
  let blobUrlCache: string | null = null;
  let helperScriptPromise: Promise<any> | null = null;

  const asyncPresent = functions.some((fn) =>
    fn.toString().includes('__async'),
  );

  const createWorker = async (): Promise<Worker> => {
    let helperScript = '';
    if (asyncPresent) {
      // If the helper script is not cached and not being fetched, start fetching
      if (!helperScriptCache && !fetchingHelperScript) {
        fetchingHelperScript = true; // Mark fetching as in progress
        helperScriptPromise = fetch(
          'https://unpkg.com/@actioncrew/streamix@1.0.10/fesm2022/actioncrew-streamix-coroutine-async.mjs',
        )
          .then((response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch helper script: ${response.statusText}`);
            }
            return response.text();
          })
          .then((script) => {
            helperScriptCache = script; // Cache the helper script
            return script;
          })
          .catch((error) => {
            console.error('Error fetching helper script:', error);
            throw error;
          })
          .finally(() => {
            fetchingHelperScript = false; // Reset fetching flag
          });
      }

      // If the helper script is being fetched, wait for it to complete
      if (fetchingHelperScript) {
        helperScript = await helperScriptPromise;
      } else {
        helperScript = helperScriptCache || '';
      }
    }

    const [mainTask, ...dependencies] = functions;

    const injectedDependencies = dependencies
      .map((fn) => {
        let fnBody = fn.toString();
        fnBody = fnBody.replace(/function[\s]*\(/, `function ${fn.name}(`);
        return fnBody;
      })
      .join(';\n');

    const mainTaskBody = mainTask
      .toString()
      .replace(/function[\s]*\(/, `function ${mainTask.name}(`);

    const workerBody = `
            ${helperScript}
            ${injectedDependencies};
            const mainTask = ${mainTaskBody};
            onmessage = async (event) => {
                try {
                    const result = await mainTask(event.data);
                    postMessage(result);
                } catch (error) {
                    postMessage({ error: error.message });
                }
            };
        `;

    // Only create the Blob URL once
    if (!blobUrlCache) {
      const blob = new Blob([workerBody], { type: 'application/javascript' });
      blobUrlCache = URL.createObjectURL(blob); // Cache the Blob URL
    }

    return new Worker(blobUrlCache, { type: 'module' });
  };

  const getIdleWorker = async (): Promise<Worker> => {
    if (workerPool.length > 0) {
      return workerPool.shift()!;
    }

    if (createdWorkersCount < maxWorkers) {
      createdWorkersCount++;
      return await createWorker();
    }

    return new Promise<Worker>((resolve) => {
      workerQueue.push(resolve);
    });
  };

  const returnWorker = (worker: Worker): void => {
    if (workerQueue.length > 0) {
      const resolve = workerQueue.shift()!;
      resolve(worker);
    } else {
      workerPool.push(worker);
    }
  };

  const processTask = async function* (
    input: Stream,
  ): AsyncGenerator<any, void, unknown> {
    try {
      for await (const emission of input) {
        const worker = await getIdleWorker();
        try {
          const data = await new Promise<any>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent) => {
              if (event.data.error) {
                reject(event.data.error);
              } else {
                resolve(event.data);
              }
            };

            worker.onerror = (error: ErrorEvent) => {
              reject(error.message);
            };

            worker.postMessage(emission.value);
          });

          yield createEmission({ value: data });
        } finally {
          returnWorker(worker);
        }
      }
    } catch (error) {
      throw error;
    }
  };

  const finalize = async () => {
    if (isFinalizing) return;
    isFinalizing = true;

    workerPool.forEach((worker) => worker.terminate());
    workerPool.length = 0;
    workerQueue.length = 0;

    if (blobUrlCache) {
      URL.revokeObjectURL(blobUrlCache); // Revoke the Blob URL
      blobUrlCache = null;
    }
  };

  const operator = createStreamOperator('coroutine', (stream: Stream) => {
    const subject = createSubject<any>() as Subject<any> & Coroutine;

    (async () => {
      try {
        for await (const value of processTask(stream)) {
          subject.next(value);
        }
        subject.complete();
      } catch (error) {
        subject.error?.(error);
      }
    })();

    return subject;
  }) as Coroutine;

  operator.finalize = finalize;
  operator.getIdleWorker = getIdleWorker;
  operator.returnWorker = returnWorker;
  return operator;
};
