import { connectionMongo, getMongoModel } from '../../../common/mongo';
const { Schema, model, models } = connectionMongo;
import { type DatasetDataSchemaType } from '@fastgpt/global/core/dataset/type.d';
import {
  TeamCollectionName,
  TeamMemberCollectionName
} from '@fastgpt/global/support/user/team/constant';
import { DatasetCollectionName } from '../schema';
import { DatasetColCollectionName } from '../collection/schema';
import { DatasetDataIndexTypeEnum } from '@fastgpt/global/core/dataset/data/constants';

export const DatasetDataCollectionName = 'dataset_datas';

const DatasetDataSchema = new Schema({
  teamId: {
    type: Schema.Types.ObjectId,
    ref: TeamCollectionName,
    required: true
  },
  tmbId: {
    type: Schema.Types.ObjectId,
    ref: TeamMemberCollectionName,
    required: true
  },
  datasetId: {
    type: Schema.Types.ObjectId,
    ref: DatasetCollectionName,
    required: true
  },
  collectionId: {
    type: Schema.Types.ObjectId,
    ref: DatasetColCollectionName,
    required: true
  },
  q: {
    type: String,
    required: true
  },
  a: {
    type: String,
    default: ''
  },
  history: {
    type: [
      {
        q: String,
        a: String,
        updateTime: Date
      }
    ]
  },
  indexes: {
    type: [
      {
        // Abandon
        defaultIndex: {
          type: Boolean
        },
        type: {
          type: String,
          enum: Object.values(DatasetDataIndexTypeEnum),
          default: DatasetDataIndexTypeEnum.custom
        },
        dataId: {
          type: String,
          required: true
        },
        text: {
          type: String,
          required: true
        }
      }
    ],
    default: []
  },

  updateTime: {
    type: Date,
    default: () => new Date()
  },
  chunkIndex: {
    type: Number,
    default: 0
  },
  rebuilding: Boolean,

  // Abandon
  fullTextToken: String,
  initFullText: Boolean,
  initJieba: Boolean
});

try {
  // list collection and count data; list data; delete collection(relate data)
  DatasetDataSchema.index({
    teamId: 1,
    datasetId: 1,
    collectionId: 1,
    chunkIndex: 1,
    updateTime: -1
  });
  // Recall vectors after data matching
  DatasetDataSchema.index({ teamId: 1, datasetId: 1, collectionId: 1, 'indexes.dataId': 1 });
  DatasetDataSchema.index({ updateTime: 1 });
  // rebuild data
  DatasetDataSchema.index({ rebuilding: 1, teamId: 1, datasetId: 1 });

  // 为查询 initJieba 字段不存在的数据添加索引
  DatasetDataSchema.index({ initJieba: 1, updateTime: 1 });
} catch (error) {
  console.log(error);
}

import { addEsSyncJob } from '../../../common/bullmq';
import { ENABLE_ELASTICSEARCH } from '@fastgpt/global/common/system/config';

// Middleware to enqueue a job after a new document is saved
DatasetDataSchema.post('save', async function (doc) {
  if (ENABLE_ELASTICSEARCH && doc?._id) {
    try {
      await addEsSyncJob(doc._id.toString());
    } catch (error) {
      console.error(`Failed to enqueue Elasticsearch sync job for saved doc ${doc._id}`, error);
    }
  }
});

// Middleware to enqueue a job after a document is updated via findOneAndUpdate
DatasetDataSchema.post('findOneAndUpdate', async function (result) {
  // `this` refers to the query object. `result` is the updated document.
  // We need to get the document ID from the query or result.
  // If `result` is null, it means no document was found and updated.
  if (ENABLE_ELASTICSEARCH && result?._id) {
    try {
      // result._id should contain the ID of the updated document
      await addEsSyncJob(result._id.toString());
    } catch (error) {
      console.error(`Failed to enqueue Elasticsearch sync job for updated doc ${result._id}`, error);
    }
  } else if (ENABLE_ELASTICSEARCH && !result) {
    // This case might happen if the update didn't modify any document (e.g., query didn't match)
    // Or if the operation was a `findOneAndDelete` which also triggers findOneAndUpdate middleware in some drivers/versions.
    // We might want to log this for debugging if it's unexpected.
    // console.log('Post findOneAndUpdate called but no document was returned/updated.');
  }
});


export const MongoDatasetData = getMongoModel<DatasetDataSchemaType>(
  DatasetDataCollectionName,
  DatasetDataSchema
);
