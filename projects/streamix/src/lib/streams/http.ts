import { createEmission, createStream, Stream } from "../abstractions";

// Type for interceptors
export type RequestInterceptor = (request: Request) => Request | Promise<Request>;
export type ResponseInterceptor = (response: Response) => Response | Promise<Response>;

export type HttpStream = Stream & { abort: () => void; };

export type HttpFetch = {
  (url: string, options?: RequestInit, onProgress?: (progress: number) => void): HttpStream;
  addRequestInterceptor: (interceptor: RequestInterceptor) => void;
  removeRequestInterceptor: (interceptor: RequestInterceptor) => void;
  addResponseInterceptor: (interceptor: ResponseInterceptor) => void;
  removeResponseInterceptor: (interceptor: ResponseInterceptor) => void;
};

let requestInterceptors: RequestInterceptor[] = [];
let responseInterceptors: ResponseInterceptor[] = [];

export const http: HttpFetch = function(url: string, options?: RequestInit, onProgress?: (progress: number) => void): HttpStream {
  let abortController = new AbortController();

  // Apply interceptors
  const applyRequestInterceptors = async (request: Request): Promise<Request> => {
    for (let interceptor of requestInterceptors) {
      request = await interceptor(request);
    }
    return request;
  };

  const applyResponseInterceptors = async (response: Response): Promise<Response> => {
    for (let interceptor of responseInterceptors) {
      response = await interceptor(response);
    }
    return response;
  };

  // Fetch with interceptors
  const fetchWithInterceptors = async () => {
    if (abortController.signal.aborted) {
      return new Response(JSON.stringify({ error: "Request aborted" }), { status: 408 });
    }

    let request = new Request(url, options);
    request = await applyRequestInterceptors(request);
    const finalRequest = new Request(request, { signal: abortController.signal });

    try {
      const response = await fetch(finalRequest);
      return applyResponseInterceptors(response);
    } catch (error: any) {
      if (error.name === "AbortError") {
        return new Response(JSON.stringify({ error: "Request aborted" }), { status: 408 });
      }
      return new Response(JSON.stringify({ error: `Request failed: ${error.message}` }), { status: 500 });
    }
  };

  // Stream generator
  async function* streamGenerator() {
    const response = await fetchWithInterceptors();
    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const contentType = response.headers.get("Content-Type") || "";
    const isText = contentType.includes("text") || contentType.includes("json");

    let encoding = "utf-8";
    const match = contentType.match(/charset=([^;]+)/);
    if (match) encoding = match[1].trim().toLowerCase();

    const contentLength = response.headers.get("Content-Length");
    const totalSize = contentLength ? parseInt(contentLength, 10) : null;
    let loaded = 0;

    onProgress?.(0);

    if (!response.body) {
      const value = isText ? await response.text() : new Uint8Array(await response.arrayBuffer());
      onProgress?.(1);
      yield createEmission({ value });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder(encoding);

    if (isText) {
      let fullText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });

        loaded += value.length;
        onProgress?.(totalSize ? loaded / totalSize : 0.5);
      }

      onProgress?.(1); // Ensure progress is 100% at the end
      yield createEmission({ value: fullText });

    } else {
      let allChunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        allChunks.push(value);

        loaded += value.length;
        onProgress?.(totalSize ? loaded / totalSize : 0.5);
      }

      onProgress?.(1); // Ensure progress is 100% at the end
      const fullBinary = new Uint8Array(allChunks.reduce<number[]>((acc, val) => acc.concat([...val]), []));
      yield createEmission({ value: fullBinary });
    }
  }

  const stream = createStream("fetchStream", streamGenerator) as HttpStream;
  stream.abort = () => {
    abortController.abort();
  };

  return stream;
} as HttpFetch;

// Interceptor functions
http.addRequestInterceptor = (interceptor: RequestInterceptor) => requestInterceptors.push(interceptor);
http.removeRequestInterceptor = (interceptor: RequestInterceptor) => {
  requestInterceptors = requestInterceptors.filter(i => i !== interceptor);
};
http.addResponseInterceptor = (interceptor: ResponseInterceptor) => responseInterceptors.push(interceptor);
http.removeResponseInterceptor = (interceptor: ResponseInterceptor) => {
  responseInterceptors = responseInterceptors.filter(i => i !== interceptor);
};
