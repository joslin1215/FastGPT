import { searchDocuments, ES_ENABLED } from '../../../common/elasticsearch';
import { MongoDatasetDataText } from '../data/dataTextSchema';
import type { Types } from '../../../common/mongo';
import { addLog } from '../../../common/system/log';
import { readFromSecondary } from '../../../common/mongo/utils';

type FullTextSearchProps = {
  teamId: string;
  datasetIds: string[];
  query: string;
  limit: number;
  forbidCollectionIdList: string[];
  filterCollectionIdList?: string[];
};

type SearchResult = {
  dataId: Types.ObjectId;
  collectionId: string;
  score: number;
};

/**
 * 使用Elasticsearch进行全文搜索
 */
export const fullTextSearchByES = async ({
  teamId,
  datasetIds,
  query,
  limit,
  forbidCollectionIdList,
  filterCollectionIdList
}: FullTextSearchProps): Promise<{
  results: SearchResult[];
}> => {
  try {
    if (!ES_ENABLED) {
      throw new Error('Elasticsearch is not enabled');
    }

    // 构造Elasticsearch查询
    const esQuery = {
      size: limit,
      query: {
        bool: {
          must: [
            {
              match: {
                fullText: query
              }
            },
            {
              terms: {
                teamId: [teamId]
              }
            },
            {
              terms: {
                datasetId: datasetIds
              }
            }
          ],
          must_not:
            forbidCollectionIdList.length > 0
              ? [
                  {
                    terms: {
                      collectionId: forbidCollectionIdList
                    }
                  }
                ]
              : []
        }
      }
    };

    // 如果有集合过滤，添加到查询中
    if (filterCollectionIdList && filterCollectionIdList.length > 0) {
      esQuery.query.bool.must.push({
        terms: {
          collectionId: filterCollectionIdList
        }
      });
    }

    // 执行Elasticsearch搜索
    const result = await searchDocuments('dataset_data_texts', esQuery);

    // 转换结果格式
    const hits = result.hits.hits || [];

    // 查询相关联的数据
    const dataTextIds = hits.map((hit: any) => hit._id);
    const dataTexts =
      dataTextIds.length > 0
        ? await MongoDatasetDataText.find({ _id: { $in: dataTextIds } }, 'dataId collectionId', {
            ...readFromSecondary
          }).lean()
        : [];

    // 构建结果映射
    const dataTextMap = new Map();
    dataTexts.forEach((dataText) => {
      dataTextMap.set(dataText._id.toString(), {
        dataId: dataText.dataId,
        collectionId: dataText.collectionId
      });
    });

    // 整合最终结果
    const results = hits
      .map((hit: any) => {
        const dataText = dataTextMap.get(hit._id);
        if (!dataText) return null;

        return {
          dataId: dataText.dataId,
          collectionId: dataText.collectionId,
          score: hit._score || 0
        };
      })
      .filter(Boolean);

    return { results };
  } catch (error) {
    addLog.warn('Elasticsearch search failed, fallback to MongoDB', error);
    throw error; // 抛出错误以触发降级到MongoDB
  }
};

/**
 * 使用MongoDB进行全文搜索
 */
export const fullTextSearchByMongo = async ({
  teamId,
  datasetIds,
  query,
  limit,
  forbidCollectionIdList,
  filterCollectionIdList
}: FullTextSearchProps): Promise<{
  results: SearchResult[];
}> => {
  // 构建MongoDB全文搜索查询条件
  const searchCondition: any = {
    teamId,
    datasetId: { $in: datasetIds },
    $text: { $search: query }
  };

  // 添加集合过滤条件
  if (forbidCollectionIdList.length > 0) {
    searchCondition.collectionId = { $nin: forbidCollectionIdList };
  }
  if (filterCollectionIdList && filterCollectionIdList.length > 0) {
    searchCondition.collectionId = {
      ...searchCondition.collectionId,
      $in: filterCollectionIdList
    };
  }

  // 执行MongoDB全文搜索
  const results = await MongoDatasetDataText.find(searchCondition, {
    score: { $meta: 'textScore' },
    dataId: 1,
    collectionId: 1
  })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();

  // 转换结果格式
  return {
    results: results.map((item) => ({
      dataId: item.dataId,
      collectionId: item.collectionId,
      score: item.score || 0
    }))
  };
};

/**
 * 全文搜索（支持Elasticsearch和MongoDB）
 * 当Elasticsearch可用时使用ES搜索，否则降级到MongoDB
 */
export const fullTextSearch = async (
  props: FullTextSearchProps
): Promise<{
  results: SearchResult[];
  usingElasticsearch: boolean;
}> => {
  // 尝试使用Elasticsearch搜索
  if (ES_ENABLED) {
    try {
      const results = await fullTextSearchByES(props);
      return {
        ...results,
        usingElasticsearch: true
      };
    } catch (error) {
      // Elasticsearch搜索失败，降级到MongoDB
      addLog.warn('Elasticsearch search failed, fallback to MongoDB', error);
    }
  }

  // 使用MongoDB搜索
  const results = await fullTextSearchByMongo(props);
  return {
    ...results,
    usingElasticsearch: false
  };
};
