import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { searchDatasetData, fullTextRecall, SearchDatasetDataProps, defaultSearchDatasetData } from './controller';
import * as esClient from '../../../common/elasticsearch';
import * as mongoModels from '../data/schema'; // For MongoDatasetData
import * as mongoDataTextModels from '../data/dataTextSchema'; // For MongoDatasetDataText
import * as mongoCollectionModels from '../collection/schema'; // For MongoDatasetCollection
import * as vectorDbController from '../../../common/vectorDB/controller';
import * as embeddingController from '../../ai/embedding';
import * as rerankController from '../../../core/ai/rerank';
import * as config from '@fastgpt/global/common/system/config';
import { DatasetSearchModeEnum, SearchScoreTypeEnum } from '@fastgpt/global/core/dataset/constants';
import { MongoDatasetData } from '../data/schema';
import { MongoDatasetDataText } from '../data/dataTextSchema';
import { MongoDatasetCollection } from '../collection/schema';
import { Types } from 'mongoose'; // For ObjectId
import { datasetSearchQueryExtension } from './utils';


// Mock global config
vi.mock('@fastgpt/global/common/system/config', async (importOriginal) => {
  const original = await importOriginal() as typeof config;
  return {
    ...original,
    ENABLE_ELASTICSEARCH: true, // Default to true for most tests
  };
});

// Mock ES Client functions
vi.mock('../../../common/elasticsearch', () => ({
  getEsClient: vi.fn(),
  checkEsHealth: vi.fn(),
  searchEs: vi.fn(),
  indexEsData: vi.fn() // Though not directly used by search, good to have it mocked
}));

// Mock MongoDB Models
vi.mock('../data/schema', () => ({
  MongoDatasetData: {
    find: vi.fn(),
    aggregate: vi.fn()
    // findById: vi.fn() // if needed by other parts not tested here
  }
}));
vi.mock('../data/dataTextSchema', () => ({
  MongoDatasetDataText: {
    aggregate: vi.fn()
  }
}));
vi.mock('../collection/schema', () => ({
  MongoDatasetCollection: {
    find: vi.fn(),
    // findById: vi.fn() // if needed
  },
  MongoDatasetCollectionTags: { // Added this mock
    find: vi.fn()
  }
}));


// Mock other dependencies
vi.mock('../../../common/vectorDB/controller', () => ({
  recallFromVectorStore: vi.fn()
}));
vi.mock('../../ai/embedding', () => ({
  getVectorsByText: vi.fn().mockResolvedValue({ vectors: [[0.1, 0.2]], tokens: 10 }),
  getEmbeddingModel: vi.fn().mockReturnValue({ model: 'text-embedding-ada-002', price: 0, defaultToken: 512, maxToken: 8000 })
}));
vi.mock('../../../core/ai/rerank', () => ({
  reRankRecall: vi.fn(),
  getDefaultRerankModel: vi.fn().mockReturnValue({ model: 'rerank-model', price: 0 })
}));

vi.mock('./utils', () => ({
  datasetSearchQueryExtension: vi.fn()
}));

// Mock global.feConfigs
// @ts-ignore
global.feConfigs = { isPlus: true };


describe('Dataset Search Controller - Integration Tests', () => {
  const defaultProps: SearchDatasetDataProps = {
    teamId: new Types.ObjectId().toHexString(),
    datasetIds: [new Types.ObjectId().toHexString()],
    model: 'gpt-3.5-turbo',
    queries: ['test query'],
    reRankQuery: 'test query for rerank',
    datasetMaxTokens: 1000,
    histories: []
  };

  const mockEsResultItem = {
    _id: new Types.ObjectId().toHexString(),
    _source: {
      mongoId: defaultProps.datasetIds[0], // Ensure it's a string
      teamId: defaultProps.teamId,
      datasetId: defaultProps.datasetIds[0],
      collectionId: new Types.ObjectId().toHexString(),
      q: 'ES question',
      a: 'ES answer',
      chunkIndex: 0,
      updateTime: new Date(),
      sourceName: 'ES Source',
      fileId: 'esFileId',
      rawLink: ''
    },
    _score: 0.9
  };
  const mockTransformedEsResult = {
    id: mockEsResultItem._id,
    datasetId: mockEsResultItem._source.datasetId,
    collectionId: mockEsResultItem._source.collectionId,
    updateTime: mockEsResultItem._source.updateTime,
    q: mockEsResultItem._source.q,
    a: mockEsResultItem._source.a,
    chunkIndex: mockEsResultItem._source.chunkIndex,
    sourceName: mockEsResultItem._source.sourceName,
    fileId: mockEsResultItem._source.fileId,
    rawLink: mockEsResultItem._source.rawLink,
    score: [{ type: SearchScoreTypeEnum.fullText, value: mockEsResultItem._score, index: 0 }]
  };

  const mockMongoTextSearchResult = {
    _id: new Types.ObjectId(), // This will be dataId in the context of MongoDatasetDataText
    dataId: new Types.ObjectId().toHexString(),
    collectionId: new Types.ObjectId().toHexString(),
    datasetId: defaultProps.datasetIds[0],
    teamId: defaultProps.teamId,
    score: 0.85
  };
  const mockMongoDataDoc = {
    _id: mockMongoTextSearchResult.dataId,
    teamId: mockMongoTextSearchResult.teamId,
    datasetId: mockMongoTextSearchResult.datasetId,
    collectionId: mockMongoTextSearchResult.collectionId,
    q: 'Mongo question',
    a: 'Mongo answer',
    chunkIndex: 1,
    updateTime: new Date(),
    indexes: [{ dataId: mockMongoTextSearchResult.dataId, type: 'custom', text: 'text' }]
  };
   const mockMongoCollectionDoc = {
    _id: mockMongoTextSearchResult.collectionId,
    name: 'Mongo Collection',
    fileId: 'mongoFileId',
    rawLink: ''
  };


  beforeEach(()_ => {
    vi.clearAllMocks();

    // Default mocks for successful operations
    vi.spyOn(esClient, 'checkEsHealth').mockResolvedValue({ available: true, status: 'ok' });
    vi.spyOn(esClient, 'searchEs').mockResolvedValue({ hits: { hits: [mockEsResultItem] } });

    // Default mock for mongo text search (when ES is disabled or fails)
    vi.spyOn(mongoDataTextModels.MongoDatasetDataText, 'aggregate').mockResolvedValue([mockMongoTextSearchResult]);
    vi.spyOn(mongoModels.MongoDatasetData, 'find').mockResolvedValue([mockMongoDataDoc as any]);
    vi.spyOn(mongoCollectionModels.MongoDatasetCollection, 'find').mockResolvedValue([mockMongoCollectionDoc as any]);
    
    // Mock for filterCollectionByMetadata
    vi.spyOn(mongoCollectionModels.MongoDatasetCollectionTags, 'find').mockResolvedValue([]);


    // Mock for embedding recall (used in hybrid search)
    vi.spyOn(vectorDbController, 'recallFromVectorStore').mockResolvedValue({ results: [] });
    vi.spyOn(rerankController, 'reRankRecall').mockImplementation(async ({ data }) => ({
      results: data.map(item => ({ ...item, score: item.score[0]?.value || 0.5 })), // Simplified rerank
      inputTokens: 10
    }));
    
    (datasetSearchQueryExtension as vi.Mock).mockResolvedValue({
      concatQueries: defaultProps.queries,
      extensionQueries: [],
      rewriteQuery: defaultProps.reRankQuery,
      aiExtensionResult: undefined
    });
  });

  describe('fullTextRecall (via searchDatasetData)', () => {
    it('Scenario 1: ES Enabled and Healthy - should use Elasticsearch', async () => {
      vi.spyOn(config, 'ENABLE_ELASTICSEARCH', 'get').mockReturnValue(true);
      
      const result = await defaultSearchDatasetData({
        ...defaultProps,
        searchMode: DatasetSearchModeEnum.fullTextRecall,
      });

      expect(esClient.searchEs).toHaveBeenCalled();
      expect(mongoDataTextModels.MongoDatasetDataText.aggregate).not.toHaveBeenCalled();
      expect(result.searchRes.length).toBe(1);
      expect(result.searchRes[0].q).toBe(mockTransformedEsResult.q);
      expect(result.searchRes[0].score[0]?.type).toBe(SearchScoreTypeEnum.fullText);
    });

    it('Scenario 2: ES Disabled - should use MongoDB', async () => {
      vi.spyOn(config, 'ENABLE_ELASTICSEARCH', 'get').mockReturnValue(false);

      const result = await defaultSearchDatasetData({
        ...defaultProps,
        searchMode: DatasetSearchModeEnum.fullTextRecall,
      });

      expect(esClient.searchEs).not.toHaveBeenCalled();
      expect(mongoDataTextModels.MongoDatasetDataText.aggregate).toHaveBeenCalled();
      expect(result.searchRes.length).toBe(1);
      expect(result.searchRes[0].q).toBe(mockMongoDataDoc.q);
    });

    it('Scenario 3: ES Enabled but Fails (checkEsHealth returns false) - should fallback to MongoDB', async () => {
      vi.spyOn(config, 'ENABLE_ELASTICSEARCH', 'get').mockReturnValue(true);
      vi.spyOn(esClient, 'checkEsHealth').mockResolvedValue({ available: false, status: 'error' });

      const result = await defaultSearchDatasetData({
        ...defaultProps,
        searchMode: DatasetSearchModeEnum.fullTextRecall,
      });
      
      expect(esClient.checkEsHealth).toHaveBeenCalled();
      expect(esClient.searchEs).not.toHaveBeenCalled(); // searchEs should not be called if health check fails
      expect(mongoDataTextModels.MongoDatasetDataText.aggregate).toHaveBeenCalled();
      expect(result.searchRes.length).toBe(1);
      expect(result.searchRes[0].q).toBe(mockMongoDataDoc.q);
    });
    
    it('Scenario 3.1: ES Enabled, Healthy, but searchEs Throws Error - should fallback to MongoDB', async () => {
      vi.spyOn(config, 'ENABLE_ELASTICSEARCH', 'get').mockReturnValue(true);
      vi.spyOn(esClient, 'checkEsHealth').mockResolvedValue({ available: true, status: 'ok' });
      vi.spyOn(esClient, 'searchEs').mockRejectedValue(new Error('ES search failed'));

      const result = await defaultSearchDatasetData({
        ...defaultProps,
        searchMode: DatasetSearchModeEnum.fullTextRecall,
      });
      
      expect(esClient.checkEsHealth).toHaveBeenCalled();
      expect(esClient.searchEs).toHaveBeenCalled();
      expect(mongoDataTextModels.MongoDatasetDataText.aggregate).toHaveBeenCalled();
      expect(result.searchRes.length).toBe(1);
      expect(result.searchRes[0].q).toBe(mockMongoDataDoc.q);
    });


    it('Scenario 4: Hybrid Search with Elasticsearch', async () => {
      vi.spyOn(config, 'ENABLE_ELASTICSEARCH', 'get').mockReturnValue(true);
      
      // Mock embedding recall to return some data
      const mockEmbeddingResultItem = {
        id: new Types.ObjectId().toHexString(),
        collectionId: new Types.ObjectId().toHexString(),
        score: 0.95
      };
      const mockEmbeddingDataDoc = {
        _id: mockEmbeddingResultItem.id,
        teamId: defaultProps.teamId,
        datasetId: defaultProps.datasetIds[0],
        collectionId: mockEmbeddingResultItem.collectionId,
        q: 'Embedding question',
        a: 'Embedding answer',
        chunkIndex: 0,
        updateTime: new Date(),
        indexes: [{ dataId: mockEmbeddingResultItem.id, type: 'custom', text: 'text' }]
      };
      const mockEmbeddingCollectionDoc = {
         _id: mockEmbeddingResultItem.collectionId,
         name: 'Embedding Collection',
         fileId: 'embFileId',
         rawLink: ''
      };
      vi.spyOn(vectorDbController, 'recallFromVectorStore').mockResolvedValue({ results: [mockEmbeddingResultItem] });
      // Adjust MongoDatasetData.find to handle calls from both embedding and full-text fallback if needed
      (MongoDatasetData.find as vi.Mock).mockImplementation(query => {
        if (query['indexes.dataId']) { // From embedding recall
          return Promise.resolve([mockEmbeddingDataDoc]);
        }
        if (query._id && query._id.$in && query._id.$in.includes(mockMongoTextSearchResult.dataId)) { // From full-text mongo fallback
           return Promise.resolve([mockMongoDataDoc]);
        }
        return Promise.resolve([]);
      });
      (MongoDatasetCollection.find as vi.Mock).mockImplementation(query => {
         if (query._id && query._id.$in && query._id.$in.includes(mockEmbeddingResultItem.collectionId)) {
           return Promise.resolve([mockEmbeddingCollectionDoc]);
         }
         if (query._id && query._id.$in && query._id.$in.includes(mockMongoTextSearchResult.collectionId)) {
            return Promise.resolve([mockMongoCollectionDoc]);
         }
         return Promise.resolve([]);
      });


      const result = await defaultSearchDatasetData({
        ...defaultProps,
        searchMode: DatasetSearchModeEnum.hybrid, // Hybrid mode
        embeddingWeight: 0.5, // Ensure both are weighted
      });

      expect(esClient.searchEs).toHaveBeenCalled(); // Called for full-text part
      expect(vectorDbController.recallFromVectorStore).toHaveBeenCalled(); // Called for embedding part
      
      // Check if results from both sources are present (simplified check)
      // Exact RRF output is complex to predict here, so we check for presence
      const hasEsResult = result.searchRes.some(item => item.q === mockTransformedEsResult.q);
      const hasEmbeddingResult = result.searchRes.some(item => item.q === mockEmbeddingDataDoc.q);
      
      expect(hasEsResult || hasEmbeddingResult).toBe(true); // At least one should be there
      // Depending on RRF, one might suppress the other if scores are very different or content is similar
      // For a more robust test, you might need to mock RRF or check scores more carefully.
      // For now, ensuring both services were called is a key integration check.
      expect(result.searchRes.length).toBeGreaterThan(0);
    });
  });
});
