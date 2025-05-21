import { getWorker, QueueNames, ElasticsearchSyncJobPayload } from '../../../common/bullmq';
import { ENABLE_ELASTICSEARCH } from '@fastgpt/global/common/system/config';
import { addLog } from '../../../common/system/log';
import { Worker, Job } from 'bullmq'; // Required for processor type
import { newWorkerRedisConnection } from '../../../common/redis'; // For worker connection

// Import the actual processor function from the worker file
// Assuming the worker file exports its processor or a function that can be used as one.
// For this example, let's assume the worker file itself sets up the worker.
// So, we just need to ensure it's loaded.

if (ENABLE_ELASTICSEARCH) {
  addLog.info('Attempting to initialize Elasticsearch Sync Worker (core module)...');
  // The actual worker logic is in 'packages/service/worker/elasticsearchSync.ts'
  // That file should be responsible for creating the Worker instance with its processor.
  // Here, we just need to ensure that file is loaded by Node.js so it can execute.
  try {
    require('../../../worker/elasticsearchSync'); // Adjust path as necessary
    addLog.info('Elasticsearch Sync Worker module loaded (core module). Worker should be running if enabled.');
  } catch (error) {
    addLog.error('Failed to load Elasticsearch Sync Worker module (core module).', error);
  }
} else {
  addLog.info('Elasticsearch Sync is disabled by configuration (core module). Worker not started.');
}

// This file might also be used to export functions related to managing the queue if needed,
// but for just starting the worker, ensuring the worker file is loaded is the key.
// For example, if we needed to manually trigger jobs from other parts of the 'core' code,
// we could re-export 'addEsSyncJob' or similar helpers here.
export { addEsSyncJob } from '../../../common/bullmq';

// A placeholder function to explicitly initialize, though require should do it.
export const initEsSyncQueueAndWorker = () => {
  if (ENABLE_ELASTICSEARCH) {
    addLog.info('Explicitly initializing Elasticsearch Sync Worker (initEsSyncQueueAndWorker).');
    // This is mostly a confirmation. The worker in elasticsearchSync.ts should self-initialize.
  }
};
