import {
  type ConnectionOptions,
  type Processor,
  Queue,
  type QueueOptions,
  Worker,
  type WorkerOptions
} from 'bullmq';
import { addLog } from '../system/log';
import { newQueueRedisConnection, newWorkerRedisConnection } from '../redis';

const defaultWorkerOpts: Omit<ConnectionOptions, 'connection'> = {
  removeOnComplete: {
    count: 0 // Delete jobs immediately on completion
  },
  removeOnFail: {
    count: 0 // Delete jobs immediately on failure
  }
};

export enum QueueNames {
  websiteSync = 'websiteSync',
  elasticsearchSync = 'elasticsearchSync'
}

// Define payload structure for Elasticsearch sync job
export interface ElasticsearchSyncJobPayload {
  mongoDataId: string;
  // Potentially add action type: 'index', 'update', 'delete' if needed in the future
  // action: 'index' | 'update' | 'delete'; 
}

export const queues = (() => {
  if (!global.queues) {
    global.queues = new Map<QueueNames, Queue>();
  }
  return global.queues;
})();
export const workers = (() => {
  if (!global.workers) {
    global.workers = new Map<QueueNames, Worker>();
  }
  return global.workers;
})();

export function getQueue<DataType, ReturnType = void>(
  name: QueueNames,
  opts?: Omit<QueueOptions, 'connection'>
): Queue<DataType, ReturnType> {
  // check if global.queues has the queue
  const queue = queues.get(name);
  if (queue) {
    return queue as Queue<DataType, ReturnType>;
  }
  const newQueue = new Queue<DataType, ReturnType>(name.toString(), {
    connection: newQueueRedisConnection(),
    ...opts
  });

  // default error handler, to avoid unhandled exceptions
  newQueue.on('error', (error) => {
    addLog.error(`MQ Queue [${name}]: ${error.message}`, error);
  });
  queues.set(name, newQueue);
  return newQueue;
}

export function getWorker<DataType, ReturnType = void>(
  name: QueueNames,
  processor: Processor<DataType, ReturnType>,
  opts?: Omit<WorkerOptions, 'connection'>
): Worker<DataType, ReturnType> {
  const worker = workers.get(name);
  if (worker) {
    return worker as Worker<DataType, ReturnType>;
  }

  const newWorker = new Worker<DataType, ReturnType>(name.toString(), processor, {
    connection: newWorkerRedisConnection(),
    ...defaultWorkerOpts,
    ...opts
  });
  // default error handler, to avoid unhandled exceptions
  newWorker.on('error', (error) => {
    addLog.error(`MQ Worker [${name}]: ${error.message}`, error);
  });
  newWorker.on('failed', (jobId, error) => {
    addLog.error(`MQ Worker [${name}]: ${error.message}`, error);
  });
  workers.set(name, newWorker);
  return newWorker;
}

// Helper function to add a job to the Elasticsearch sync queue
import { ENABLE_ELASTICSEARCH } from '@fastgpt/global/common/system/config';

export const addEsSyncJob = async (mongoDataId: string) => {
  if (!ENABLE_ELASTICSEARCH) {
    // Optionally log that ES is disabled and job is not added
    // addLog.info(`Elasticsearch is disabled. Sync job for ${mongoDataId} not added.`);
    return;
  }
  try {
    const esSyncQueue = getQueue<ElasticsearchSyncJobPayload>(QueueNames.elasticsearchSync);
    await esSyncQueue.add('syncMongoDataToEs', { mongoDataId });
    addLog.info(`Added Elasticsearch sync job for mongoDataId: ${mongoDataId}`);
  } catch (error) {
    addLog.error(`Failed to enqueue Elasticsearch sync job for mongoDataId: ${mongoDataId}`, error);
    // Decide on error handling: re-throw, log, or perhaps add to a retry mechanism if critical
    // For now, just logging the error.
  }
};

export * from 'bullmq';
