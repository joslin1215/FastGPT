# Elasticsearch 支持

FastGPT 现在支持使用 Elasticsearch 作为全文搜索引擎，当 Elasticsearch 可用时，全文检索将使用 Elasticsearch 进行，性能更好且支持更高级的搜索功能。如果 Elasticsearch 不可用或者搜索失败，系统会自动降级使用 MongoDB 进行全文检索。

## 配置方法

在环境变量中添加以下配置：

```
# 是否启用 Elasticsearch，设置为 true 启用，false 禁用
ES_ENABLED=true

# Elasticsearch 服务器地址
ES_URL=http://elasticsearch:9200

# Elasticsearch 用户名（如果有）
ES_USERNAME=elastic

# Elasticsearch 密码（如果有）
ES_PASSWORD=password

# Elasticsearch 索引名称前缀，用于区分不同环境
ES_INDEX_PREFIX=fastgpt_
```

## Docker 部署方式

如果使用 Docker Compose 部署，可以在 docker-compose.yml 文件中添加 Elasticsearch 服务，示例如下：

```yaml
elasticsearch:
  image: elasticsearch:8.8.0
  container_name: elasticsearch
  restart: always
  environment:
    - discovery.type=single-node
    - ES_JAVA_OPTS=-Xms1g -Xmx1g
    - xpack.security.enabled=false
  ports:
    - 9200:9200
  volumes:
    - ./elasticsearch/data:/usr/share/elasticsearch/data
  networks:
    - fastgpt
```

然后在 FastGPT 服务配置中添加环境变量：

```yaml
fastgpt:
  container_name: fastgpt
  # ...其他配置...
  environment:
    # ...其他环境变量...
    - ES_ENABLED=true
    - ES_URL=http://elasticsearch:9200
    # 如果启用了 Elasticsearch 安全设置，需要添加下面的认证信息
    # - ES_USERNAME=elastic
    # - ES_PASSWORD=password
```

## 数据同步

启用 Elasticsearch 后，系统会自动从 MongoDB 同步数据到 Elasticsearch，确保两者之间的数据一致性。同步包括：

1. 应用启动时初始化 Elasticsearch 索引
2. 通过 MongoDB change streams 实时监控数据变更并同步到 Elasticsearch
3. 支持手动触发全量数据同步

## 混合搜索模式

当同时配置了向量数据库和 Elasticsearch 时，系统会使用混合搜索模式，结合向量相似度搜索和全文检索的结果，提供更准确的搜索结果。

## 故障转移

如果 Elasticsearch 服务不可用或搜索失败，系统会自动降级使用 MongoDB 进行全文检索，确保服务的可用性。
