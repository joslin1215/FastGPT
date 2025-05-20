# elasticsearch全文检索支持需求
## 1. 需求背景
项目全文搜索使用的是mongo，查询慢且中文分词不方便。现在需要增加elasticsearch支持

## 2. 需求描述

### 2.1. 支持配置是否启用elasticsearch
如果启用elasticsearch，则全文搜索走elasticsearch，当elasticsearch搜索失败时，降级使用Mongo，否则走mongo。
### 2.2. Mongo数据需要同步到elasticsearch，确保数据一致性
### 2.3. elasticsearch搜索结果结构保持跟当前mongo一致 
### 2.4. 混合搜索有用到全文搜索，需要同步修改