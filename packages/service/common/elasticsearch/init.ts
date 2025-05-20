import { initESClient } from './index';
import { initESIndices, setupDataTextsSyncListener } from './sync';
import { addLog } from '../system/log';

export const initElasticsearch = async () => {
  try {
    // 初始化Elasticsearch客户端
    const client = await initESClient();
    if (!client) {
      addLog.info('Elasticsearch is not enabled or connection failed');
      return;
    }

    // 初始化Elasticsearch索引
    await initESIndices();

    // 设置MongoDB数据同步到Elasticsearch的监听器
    await setupDataTextsSyncListener();

    addLog.info('Elasticsearch initialization completed');
  } catch (error) {
    addLog.error('Failed to initialize Elasticsearch', error);
  }
};
