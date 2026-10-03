import type { Delimiter } from "../parse/delimiter.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnType } from "../types.js";
import type {
  ColumnMetaMessage,
  CsvChunkMessage,
  ExportStartedMessage,
  LoadedMessage,
  ProgressMessage,
  ResultsMessage,
  RowsMessage,
  SortedMessage,
  StatsMessage,
  WorkerRequest,
  WorkerResponse,
} from "../worker/protocol.js";

interface Pending {
  resolve: (message: WorkerResponse) => void;
  reject: (error: Error) => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type WorkerRequestPayload = DistributiveOmit<WorkerRequest, "requestId">;

export interface LoadOptions {
  name: string;
  delimiter: Delimiter | "auto";
  hasHeaders: boolean;
  text?: string;
  buffer?: ArrayBuffer;
}

export class SearchWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private progressHandler: ((message: ProgressMessage) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL("../worker/search.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handle(event.data);
    this.worker.onerror = (event: ErrorEvent) => {
      const error = new Error(event.message === "" ? "Search worker crashed" : event.message);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  onProgress(handler: (message: ProgressMessage) => void): void {
    this.progressHandler = handler;
  }

  load(options: LoadOptions): Promise<LoadedMessage> {
    const transfer = options.buffer === undefined ? [] : [options.buffer];
    return this.request<LoadedMessage>({ type: "load", ...options }, transfer);
  }

  setFilter(
    column: number,
    filter: ColumnFilter | null,
    preview = false,
  ): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "setFilter", column, filter, preview });
  }

  clearFilters(): Promise<ResultsMessage> {
    return this.request<ResultsMessage>({ type: "clearFilters" });
  }

  sort(column: number, dir: 1 | -1): Promise<SortedMessage> {
    return this.request<SortedMessage>({ type: "sort", column, dir });
  }

  getRows(start: number, end: number): Promise<RowsMessage> {
    return this.request<RowsMessage>({ type: "getRows", start, end });
  }

  setType(column: number, columnType: ColumnType): Promise<ColumnMetaMessage> {
    return this.request<ColumnMetaMessage>({ type: "setType", column, columnType });
  }

  getStats(): Promise<StatsMessage> {
    return this.request<StatsMessage>({ type: "getStats" });
  }

  startExport(): Promise<ExportStartedMessage> {
    return this.request<ExportStartedMessage>({ type: "startExport" });
  }

  getCsv(start: number, end: number): Promise<CsvChunkMessage> {
    return this.request<CsvChunkMessage>({ type: "getCsv", start, end });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }

  private request<T extends WorkerResponse>(
    message: WorkerRequestPayload,
    transfer?: Transferable[],
  ): Promise<T> {
    const requestId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: WorkerResponse) => void,
        reject,
      });
      this.worker.postMessage({ ...message, requestId } as WorkerRequest, transfer ?? []);
    });
  }

  private handle(message: WorkerResponse): void {
    if (message.type === "progress") {
      this.progressHandler?.(message);
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) return;
    this.pending.delete(message.requestId);
    if (message.type === "error") pending.reject(new Error(message.message));
    else pending.resolve(message);
  }
}
