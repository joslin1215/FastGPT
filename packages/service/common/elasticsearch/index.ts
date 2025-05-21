import { Client } from '@elastic/elasticsearch';
import { ELASTICSEARCH_URL, ELASTICSEARCH_USERNAME, ELASTICSEARCH_PASSWORD, ELASTICSEARCH_API_KEY, ENABLE_ELASTICSEARCH } from '@fastgpt/global/common/system/config';

let client: Client | null = null;

if (ENABLE_ELASTICSEARCH && ELASTICSEARCH_URL) {
  client = new Client({
    node: ELASTICSEARCH_URL,
    auth: ELASTICSEARCH_API_KEY ? { apiKey: ELASTICSEARCH_API_KEY } : (ELASTICSEARCH_USERNAME && ELASTICSEARCH_PASSWORD ? { username: ELASTICSEARCH_USERNAME, password: ELASTICSEARCH_PASSWORD } : undefined)
    // Add any other necessary configurations, like SSL/TLS options if needed
  });
}

export const getEsClient = () => {
  if (!client) {
    // This case handles when ES is disabled or not configured
    // Depending on requirements, you might throw an error or return null/undefined
    // For now, let's return null, and calling functions must handle this.
    return null;
  }
  return client;
};

export const checkEsHealth = async () => {
  if (!client) {
    return { available: false, status: 'disabled' };
  }
  try {
    await client.ping();
    // More detailed health check:
    // const health = await client.cluster.health();
    // return { available: true, status: health.status };
    return { available: true, status: 'ok' }; // Simplified for now
  } catch (error) {
    console.error('Elasticsearch connection error:', error);
    return { available: false, status: 'error', error: error };
  }
};

// Add a basic search function placeholder
export const searchEs = async (index: string, queryBody: any) => {
  const esClient = getEsClient();
  if (!esClient) {
    // Fallback or error, specific to how the application wants to handle ES being unavailable
    console.warn('Elasticsearch is not available. Search request skipped.');
    return { hits: { hits: [] } }; // Mimic ES response structure for no results
  }

  try {
    const response = await esClient.search({
      index,
      body: queryBody,
    });
    return response;
  } catch (error) {
    console.error('Elasticsearch search error:', error);
    // It's important to handle errors, perhaps by re-throwing or returning a specific error structure
    throw error; // Or return an error object/empty results
  }
};

export const indexEsData = async (indexName: string, documentId: string, documentBody: any) => {
  const esClient = getEsClient();
  if (!esClient) {
    console.warn('Elasticsearch is not available. Indexing request skipped for document ID:', documentId);
    // Throw an error to be caught by the worker for retry/failure
    throw new Error('Elasticsearch client not available for indexing.');
  }

  try {
    await esClient.index({
      index: indexName,
      id: documentId, // Use MongoDB _id here
      body: documentBody,
      refresh: 'wait_for' // Or true, or remove for default behavior. 'wait_for' makes the change visible to search immediately.
    });
    // console.log(`Document ${documentId} indexed successfully into ${indexName}`);
  } catch (error) {
    console.error(`Error indexing document ${documentId} into ${indexName}:`, error);
    throw error; // Re-throw to be handled by the BullMQ job processor
  }
};
