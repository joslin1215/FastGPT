import { Worker, Job } from 'bullmq';
import { MongoDatasetData } from '../core/dataset/data/schema';
import { indexEsData, getEsClient, checkEsHealth } from '../../common/elasticsearch';
import { ENABLE_ELASTICSEARCH } from '@fastgpt/global/common/system/config';
import { QueueNames, ElasticsearchSyncJobPayload } from '../../common/bullmq';
import { newWorkerRedisConnection } from '../../common/redis';
import { addLog } from '../../common/system/log';
import { MongoDatasetCollection } from '../core/dataset/collection/schema';
import { getCollectionSourceData } from '@fastgpt/global/core/dataset/collection/utils';

if (ENABLE_ELASTICSEARCH) {
  addLog.info('Initializing Elasticsearch Sync Worker...');

  const worker = new Worker<ElasticsearchSyncJobPayload>(
    QueueNames.elasticsearchSync,
    async (job: Job<ElasticsearchSyncJobPayload>) => {
      const { mongoDataId } = job.data;
      addLog.info(`Processing ES sync job for mongoDataId: ${mongoDataId}`);

      try {
        const esClient = getEsClient();
        if (!esClient) {
          addLog.warn('Elasticsearch client not available, skipping ES sync job.');
          // Do not throw error, as this is a config issue, not a transient one.
          // Job will complete without action.
          return;
        }
        const health = await checkEsHealth();
        if (!health.available) {
          addLog.warn(`Elasticsearch not healthy (status: ${health.status}), skipping ES sync job for ${mongoDataId}.`);
          // Throw error to retry if ES is temporarily unavailable
          throw new Error(`Elasticsearch not healthy (status: ${health.status})`);
        }

        const mongoDoc = await MongoDatasetData.findById(mongoDataId).lean();

        if (!mongoDoc) {
          addLog.error(`Elasticsearch Sync: MongoDB document with ID ${mongoDataId} not found.`);
          return; // Mark job as complete, no retry needed.
        }

        const collection = await MongoDatasetCollection.findById(mongoDoc.collectionId).lean();
        if (!collection) {
          addLog.error(
            `Elasticsearch Sync: MongoDB collection with ID ${mongoDoc.collectionId} for data ${mongoDataId} not found.`
          );
          // Depending on data integrity requirements, you might throw an error to retry,
          // or decide that the data cannot be indexed without its parent collection.
          return;
        }
        const sourceData = getCollectionSourceData(collection);

        const esDoc = {
          mongoId: mongoDoc._id.toString(),
          teamId: mongoDoc.teamId.toString(),
          datasetId: mongoDoc.datasetId.toString(),
          collectionId: mongoDoc.collectionId.toString(),
          q: mongoDoc.q,
          a: mongoDoc.a,
          chunkIndex: mongoDoc.chunkIndex,
          updateTime: mongoDoc.updateTime,
          text_content: `${mongoDoc.q || ''} ${mongoDoc.a || ''}`.trim(),
          // Fields from getCollectionSourceData
          sourceName: sourceData.sourceName,
          fileId: sourceData.fileId,
          rawLink: sourceData.rawLink,
          apiFileId: sourceData.apiFileId,
          externalFileId: sourceData.externalFileId,
          externalFileUrl: sourceData.externalFileUrl
        };

        await indexEsData('dataset_data', mongoDoc._id.toString(), esDoc);
        addLog.info(`Successfully synced mongoDataId: ${mongoDataId} to ES.`);

      } catch (error: any) {
        addLog.error(`Error processing Elasticsearch sync job for mongoDataId ${mongoDataId}: ${error?.message}`, error);
        throw error; // This will cause BullMQ to retry the job based on queue settings
      }
    },
    {
      connection: newWorkerRedisConnection(), // Use centralized Redis connection
      concurrency: 5, // Adjust concurrency as needed
      removeOnComplete: { count: 1000 }, // Keep some completed jobs for audit
      removeOnFail: { count: 5000 }    // Keep more failed jobs for debugging
    }
  );

  worker.on('completed', (job) => {
    addLog.info(`ES Sync Job ${job.id} for mongoDataId ${job.data.mongoDataId} completed.`);
  });

  worker.on('failed', (job, err) => {
    addLog.error(`ES Sync Job ${job?.id} for mongoDataId ${job?.data?.mongoDataId} failed: ${err?.message}`, err);
  });

  addLog.info('Elasticsearch Sync Worker initialized.');
} else {
  addLog.info('Elasticsearch Sync Worker is disabled because ENABLE_ELASTICSEARCH is false.');
}
