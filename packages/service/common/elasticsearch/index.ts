import { Client } from '@elastic/elasticsearch';
import { addLog } from '../system/log';

// 从环境变量获取Elasticsearch配置
export const ES_ENABLED = process.env.ES_ENABLED === 'true';
export const ES_URL = process.env.ES_URL || 'http://localhost:9200';
export const ES_USERNAME = process.env.ES_USERNAME;
export const ES_PASSWORD = process.env.ES_PASSWORD;
export const ES_INDEX_PREFIX = process.env.ES_INDEX_PREFIX || 'fastgpt_';

let esClient: Client | null = null;

/**
 * 初始化Elasticsearch客户端
 */
export const initESClient = async () => {
  try {
    if (!ES_ENABLED) {
      return null;
    }

    const clientOptions: any = {
      node: ES_URL
    };

    // 如果有用户名和密码，添加认证信息
    if (ES_USERNAME && ES_PASSWORD) {
      clientOptions.auth = {
        username: ES_USERNAME,
        password: ES_PASSWORD
      };
    }

    const client = new Client(clientOptions);

    // 测试连接
    const pingRes = await client.ping();
    if (pingRes) {
      addLog.info('Elasticsearch connected');
      esClient = client;
      return client;
    }

    addLog.error('Failed to connect to Elasticsearch');
    return null;
  } catch (error) {
    addLog.error('Error connecting to Elasticsearch', error);
    return null;
  }
};

/**
 * 获取Elasticsearch客户端
 */
export const getESClient = async (): Promise<Client | null> => {
  if (esClient) {
    return esClient;
  }

  return await initESClient();
};

/**
 * 创建索引（如果不存在）
 */
export const createIndexIfNotExists = async (indexName: string, mapping: any): Promise<boolean> => {
  try {
    const client = await getESClient();
    if (!client) return false;

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    const exists = await client.indices.exists({ index: fullIndexName });
    if (exists) {
      return true;
    }

    await client.indices.create({
      index: fullIndexName,
      body: {
        mappings: mapping
      }
    });

    addLog.info(`Created Elasticsearch index: ${fullIndexName}`);
    return true;
  } catch (error) {
    addLog.error(`Error creating Elasticsearch index: ${indexName}`, error);
    return false;
  }
};

/**
 * 删除索引
 */
export const deleteIndex = async (indexName: string): Promise<boolean> => {
  try {
    const client = await getESClient();
    if (!client) return false;

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    // 检查索引是否存在
    const exists = await client.indices.exists({ index: fullIndexName });
    if (!exists) {
      return true;
    }

    await client.indices.delete({ index: fullIndexName });
    return true;
  } catch (error) {
    addLog.error(`Error deleting Elasticsearch index: ${indexName}`, error);
    return false;
  }
};

/**
 * 索引文档
 */
export const indexDocument = async (
  indexName: string,
  id: string,
  document: any
): Promise<boolean> => {
  try {
    const client = await getESClient();
    if (!client) return false;

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    await client.index({
      index: fullIndexName,
      id,
      document
    });
    return true;
  } catch (error) {
    addLog.error(`Error indexing document to ${indexName}`, error);
    return false;
  }
};

/**
 * 批量索引文档
 */
export const bulkIndexDocuments = async (
  indexName: string,
  documents: Array<{ id: string; document: any }>
): Promise<boolean> => {
  try {
    const client = await getESClient();
    if (!client) return false;

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    // 构造批量操作请求
    const operations = documents.flatMap((doc) => [
      { index: { _index: fullIndexName, _id: doc.id } },
      doc.document
    ]);

    await client.bulk({ operations });
    return true;
  } catch (error) {
    addLog.error(`Error bulk indexing documents to ${indexName}`, error);
    return false;
  }
};

/**
 * 删除文档
 */
export const deleteDocument = async (indexName: string, id: string): Promise<boolean> => {
  try {
    const client = await getESClient();
    if (!client) return false;

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    await client.delete({
      index: fullIndexName,
      id
    });
    return true;
  } catch (error) {
    addLog.error(`Error deleting document from ${indexName}`, error);
    return false;
  }
};

/**
 * 搜索文档
 */
export const searchDocuments = async (indexName: string, query: any): Promise<any> => {
  try {
    const client = await getESClient();
    if (!client) return { hits: { total: { value: 0 }, hits: [] } };

    const fullIndexName = `${ES_INDEX_PREFIX}${indexName}`;

    const result = await client.search({
      index: fullIndexName,
      ...query
    });

    return result;
  } catch (error) {
    addLog.error(`Error searching documents in ${indexName}`, error);
    return { hits: { total: { value: 0 }, hits: [] } };
  }
};
