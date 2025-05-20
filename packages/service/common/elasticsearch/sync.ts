import { MongoDatasetDataText } from '../../core/dataset/data/dataTextSchema';
import {
  getESClient,
  createIndexIfNotExists,
  bulkIndexDocuments,
  deleteDocument,
  ES_ENABLED
} from '../elasticsearch';
import { addLog } from '../system/log';
import { mongoSessionRun } from '../mongo/sessionRun';

// 数据文本索引的映射
const dataTextMapping = {
  properties: {
    teamId: { type: 'keyword' },
    datasetId: { type: 'keyword' },
    collectionId: { type: 'keyword' },
    dataId: { type: 'keyword' },
    fullText: {
      type: 'text',
      analyzer: 'standard',
      fields: {
        keyword: {
          type: 'keyword',
          ignore_above: 256
        }
      }
    }
  }
};

/**
 * 初始化Elasticsearch索引
 */
export const initESIndices = async () => {
  if (!ES_ENABLED) return;

  try {
    // 创建数据文本索引
    await createIndexIfNotExists('dataset_data_texts', dataTextMapping);
  } catch (error) {
    addLog.error('Failed to initialize Elasticsearch indices', error);
  }
};

/**
 * 将MongoDB数据同步到Elasticsearch
 * @param dataTexts 数据文本记录
 */
export const syncDataTextsToES = async (dataTexts: any[]): Promise<boolean> => {
  if (!ES_ENABLED || dataTexts.length === 0) return false;

  try {
    const documents = dataTexts.map((text) => {
      return {
        id: text._id.toString(),
        document: {
          teamId: text.teamId.toString(),
          datasetId: text.datasetId.toString(),
          collectionId: text.collectionId.toString(),
          dataId: text.dataId.toString(),
          fullText: text.fullTextToken
        }
      };
    });

    return await bulkIndexDocuments('dataset_data_texts', documents);
  } catch (error) {
    addLog.error('Failed to sync data texts to Elasticsearch', error);
    return false;
  }
};

/**
 * 从Elasticsearch中删除数据
 * @param dataTextId 数据文本ID
 */
export const deleteDataTextFromES = async (dataTextId: string): Promise<boolean> => {
  if (!ES_ENABLED) return false;

  try {
    return await deleteDocument('dataset_data_texts', dataTextId);
  } catch (error) {
    addLog.error('Failed to delete data text from Elasticsearch', error);
    return false;
  }
};

/**
 * 同步指定团队和数据集的所有数据到Elasticsearch
 * @param teamId 团队ID
 * @param datasetId 数据集ID
 */
export const syncAllDataTextsToES = async (teamId: string, datasetId: string): Promise<boolean> => {
  if (!ES_ENABLED) return false;

  try {
    const batchSize = 100;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const dataTexts = await MongoDatasetDataText.find(
        { teamId, datasetId },
        '_id teamId datasetId collectionId dataId fullTextToken'
      )
        .limit(batchSize)
        .skip(skip)
        .lean();

      if (dataTexts.length === 0) {
        hasMore = false;
        break;
      }

      await syncDataTextsToES(dataTexts);
      skip += batchSize;
    }

    return true;
  } catch (error) {
    addLog.error('Failed to sync all data texts to Elasticsearch', error);
    return false;
  }
};

/**
 * 监听MongoDB数据变更并同步到Elasticsearch
 * 这个函数可以在应用启动时调用，监听MongoDB数据变更
 */
export const setupDataTextsSyncListener = async () => {
  if (!ES_ENABLED) return;

  // 初始化ES索引
  await initESIndices();

  // 处理新增/修改的数据
  MongoDatasetDataText.watch().on('change', async (change) => {
    try {
      if (change.operationType === 'insert' || change.operationType === 'update') {
        // 获取完整的文档数据
        const dataText = await MongoDatasetDataText.findById(
          change.documentKey._id,
          '_id teamId datasetId collectionId dataId fullTextToken'
        ).lean();

        if (dataText) {
          await syncDataTextsToES([dataText]);
        }
      } else if (change.operationType === 'delete') {
        await deleteDataTextFromES(change.documentKey._id.toString());
      }
    } catch (error) {
      addLog.error('Error in dataset_data_texts change stream handler', error);
    }
  });
};
