# TripMap Account Cloud V2

更新时间：2026-08-11

状态：**Target；P1.1 合同/migration、P1.2 本地 mutation runtime 与 P1.3a 严格读取/bootstrap runtime 已实现，读写硬门槛关闭，尚未应用到 Supabase Preview 或 Production**

上游合同：

- [完整产品级交付计划](PRODUCT_GRADE_DELIVERY_PLAN.md) P1
- [产品定位与核心体验](PRODUCT_POSITIONING.md)
- [产品战略](PRODUCT_STRATEGY.md)
- [生产运行状态](PRODUCTION_RUNTIME_STATUS.md)

本文件定义账号云端从现有 `IndexedDB -> outbox -> cloud_sync_objects` 迁移到 `optimistic UI -> cloud commit -> local cache` 的正式合同。它不是已上线声明；只有 Preview 数据库、真实账号跨设备、RLS、恢复、回滚和同 SHA 发布收据全部通过后，相关能力才能从 `Target/Partial` 升级为 `Current`。

## 1. 交付结论

目标架构只有一个账号事实源：Supabase/Postgres。IndexedDB 保留三项职责：启动缓存、网络失败 outbox、应急只读副本。

在线状态下，界面可以先做可撤销的 optimistic 更新，但不得把本机写入当作完成。服务端 RPC 按 `expectedRevision + mutationId` 原子提交；收到 ack 后才把本机记录标为 durable。只有经过确认的 Action Gateway 写入才能进入同一提交入口。

离线状态下，用户写入本机对象和 outbox。恢复在线后，以原 mutation ID 重放；成功收据不会因对象后来又被修改而失效，因此旧请求重试不会重复创建对象或覆盖新 revision。

## 2. 当前与目标边界

| 范围 | 当前生产事实 | V2 目标 | 当前分支 P1.1-P1.2 |
| --- | --- | --- | --- |
| 对象写入 | IndexedDB 首写，稍后 upsert `cloud_sync_objects` | 在线 cloud-first，离线才排队 | Trip/Day/Item 单对象 adapter、revision/journal 与 coordinator 已写；硬切换常量为 `false`，旧生产路径未改变 |
| 幂等 | 当前行保留 `op_id` | 独立 mutation receipt 永久识别已完成请求 | migration 已包含私有 receipt ledger |
| 并发 | `updated_at_ms` 与本地三方合并 | 单调 revision、字段策略、结构化冲突 | revision、账号绑定、lease generation、持久冲突快照和依赖链回滚已实现；字段合并与 UI 恢复待后续 P1 |
| 删除 | `deleted_at_ms` | Realtime 可过滤的 tombstone UPDATE | 新表使用 payload 为空的 tombstone |
| Realtime | 核心旅行对象未发布 | 按 owner/trip 收敛对象和 job | migration 已声明 publication，订阅待 P1.4 |
| 恢复 | 旅行级手工恢复 | 空设备自动恢复完整账号索引与旅行 | 严格 envelope read codec、两次稳定读取、漂移计划和非破坏 revision bootstrap 已在本地/mock 实现；各对象专用 payload codec、Preview 真实收据、空设备恢复和附件恢复尚未实现 |
| 私密资料 | 独立加密 vault 和 Storage | 继续分域，只同步最小索引 | V2 明确禁止正文、OCR、Blob、Token 和密钥 |

## 3. 正式对象目录

所有对象都使用同一版本化 envelope，但 payload 仍由对象自己的合同约束。`client_mutable` 表示登录用户可以通过 revision RPC 写入；`server_managed` 表示浏览器只能读取，正式写入必须来自受控服务端流程。

| objectType | Payload contract | 写权限 | 内容边界 |
| --- | --- | --- | --- |
| `trip` | `TripV1` | client mutable | 标题、目的地、日期、时区和用户备注 |
| `day` | `DayV1` | client mutable | 日期、标题、时区和排序 |
| `item` | `ItineraryItemV1` | client mutable | 时间、地点、坐标、交通、执行状态和票据引用 |
| `ticket_meta` | `RedactedTicketMetaV1` | client mutable | ID、关系、类别和显示所需的最小 metadata；明确排除 Blob、文件名、本机路径、外部/签名 URL、备注和结构化提取字段 |
| `document_index` | `RedactedDocumentIndexV1` | client mutable | 证件类别、状态、有效期和附件数量；不含号码、正文或 OCR |
| `document_trip_link` | `DocumentTripLinkV1` | client mutable | 资料与旅行对象的关系、状态、confidence 和来源 ID |
| `transport_booking` | `TransportBookingV1` | client mutable | 预订公开字段和加密 secret 引用；不含 PNR/票号正文 |
| `transport_segment` | `TransportSegmentV1` | client mutable | 站点、班次、当地时间、时区、航站楼/站台和状态 |
| `lodging` | `LodgingReservationV1` | client mutable | 住宿、入住退房、状态和来源 |
| `insurance` | `InsurancePolicyV1` | client mutable | 保单索引、期限、提供方和原件引用；原件正文留在 vault |
| `media_asset` | `TravelMediaAssetV1` | server managed | 受控 render ref、来源、归因、权利、尺寸和 TTL |
| `realtime_fact` | `RealtimeFactV1` | server managed | 已归一事实、来源、观测时间、有效期、confidence 和 opaque rawRef |
| `ledger_settings` | `LedgerSettingsV1` | client mutable | 币种和结算设置 |
| `ledger_participant` | `LedgerParticipantV1` | client mutable | 参与人最小显示信息和来源关系 |
| `ledger_budget` | `LedgerBudgetV1` | client mutable | 旅行/类别/日期预算 |
| `ledger_expense` | `LedgerExpenseV1` | client mutable | 金额、币种、来源、分类、分摊、退款和审核状态 |
| `trip_intelligence_applied_change` | `TripIntelligenceAppliedChangeV1` | client mutable | 脱敏动作结果、影响对象和可撤销历史 |
| `trip_intelligence_suggestion_state` | `TripIntelligenceSuggestionStateV1` | client mutable | 建议完成、忽略或稍后状态 |
| `shared_task` | `SharedTaskV1` | client mutable | 任务、成员、关联对象、截止和完成状态 |
| `ai_job` | `AiJobV1` | server managed | 脱敏摘要、步骤进度、状态和错误类别；不含 prompt/raw output |
| `replan_event` | `TripDisruptionEventV1` | client mutable | 事件、影响范围、证据引用和报告者角色 |
| `replan_record` | `TripReplanRecordV1` | client mutable | 预览、差异、确认结果、撤销和补偿记录 |

代码权威目录位于 `src/lib/accountCloud/contract.ts`；载荷类型映射位于 `src/lib/accountCloud/models.ts`。SQL table constraint、RPC allowlist 和 TypeScript 目录必须由 `npm run check:account-cloud-migration` 保持一致。

## 4. 服务端 Envelope

`public.tripmap_account_objects` 每行表示一个对象的最新权威 revision：

| 字段 | 合同 |
| --- | --- |
| `owner_id` | 由 `auth.uid()` 决定，客户端不能传入 |
| `trip_id` | 旅行 scope；非空、受控长度 |
| `object_type/object_id` | 注册类型和稳定语义 ID；共同参与 owner-scoped 主键 |
| `payload` | 非删除对象必须是有界 JSON object；tombstone 必须为空 |
| `schema_version` | 对象 payload 版本，当前允许 `1..32` |
| `revision` | 从 1 开始严格递增的服务端 revision |
| `mutation_id` | 产生当前 revision 的最后 mutation |
| `actor_id` | 服务端从当前会话写入，不接受客户端声明 |
| `device_id` | 受控客户端实例 ID，用于诊断和恢复，不用于授权 |
| `tombstone/deleted_at` | 删除通过 UPDATE 广播，不物理删除当前行 |
| `created_at/updated_at` | 服务端时间；更新不改 `created_at` |

私有表 `tripmap_private.account_mutation_receipts` 独立保留 `owner + mutationId + requestHash + appliedRevision`。它不向 `anon/authenticated` 暴露，也不进入 Realtime。把收据与当前行分开是必要条件：对象进入 revision 5 后，revision 1 的网络重试仍能识别为已完成，而不会重新应用旧 payload。

## 5. 原子 Mutation RPC

公开 Data API 只暴露 `public.account_apply_object_mutation_v1`。它是 `SECURITY INVOKER` 薄包装；真实实现位于未暴露的 `tripmap_private` schema，使用空 `search_path`、显式 `auth.uid()` 校验和最小函数授权。

客户端 mutation envelope 只包含：

```ts
type AccountObjectMutationV1 = {
  schemaVersion: 1
  mutationId: string
  tripId: string
  objectType: AccountObjectType
  objectId: string
  operation: 'upsert' | 'delete'
  expectedRevision: number
  objectSchemaVersion: number
  deviceId: string
  payload?: JsonObject
}
```

适配器另外固定发送当前账号数据库的 32 位哈希 `target_account_hash`。服务端从 `auth.uid()` 独立重算并比较；它不是 owner ID，也不能改变写入 owner。请求明确不含 `ownerId`、`actorId`、SQL、表名、函数名、路由、任意控制面 URL、Blob、Token、Provider key、OCR 正文或 raw Provider payload。

RPC 固定执行顺序：

1. 从 JWT 读取 actor/owner，并验证账号哈希与当前 token 一致；拒绝未认证或跨账号上下文调用。
2. 校验版本、注册对象、客户端写权限、ID、payload identity、大小和敏感字段。
3. 对 `owner + object` 和 `owner + mutation` 获取事务级 advisory lock。
4. 查找 mutation receipt；相同内容返回 `idempotent`，不同内容复用同 ID 返回 `mutation_id_reused`。
5. `SELECT FOR UPDATE` 当前对象，比较 `expectedRevision`。
6. revision 匹配时原子写对象与 receipt；任一步失败整笔回滚。
7. 返回白名单结果，不返回 owner、SQL 错误栈或内部表结构。

结果只有四类：

- `applied`：本次 mutation 创建了新 revision。
- `idempotent`：同 mutation 已完成；同时返回当前最新对象，避免旧重试覆盖本机新状态。
- `conflict`：revision 不匹配，返回当前对象供本地冲突策略处理，不写库。
- `rejected`：目标、权限、版本、payload 或 mutation 使用不合法，不写库。

## 6. 写入状态机

### 6.1 在线写入

1. UI 生成 optimistic patch 和 rollback snapshot。
2. 写入协调器读取本机已确认的 `baseRevision`。
3. 事务性写入乐观对象和带账号哈希、原 mutation、before/after snapshot、lease generation 的本机 journal，再调用 V2 RPC。
4. `applied` 或未前进的 `idempotent` ack 原子写入 revision receipt 并删除 journal。
5. `idempotent` 若显示远端已进入更高 revision，必须转为冲突，不得把陈旧业务表标成已收敛。
6. `conflict` 回滚当前 mutation 及其依赖的本机乐观链并保留冲突收据；UI 不得显示“已保存”。
7. 认证失败保留 optimistic state 与 `blocked_auth` journal，重新登录后以原 mutation ID 恢复；权限、合同和确定性拒绝在同一事务回滚 optimistic state。网络中断、5xx、429、响应丢失或无法证明未提交的格式错误保留原 mutation ID 重放。
8. 每次协调固定绑定开始时的账号数据库实例和账号哈希。RPC 中途切换账号只会让旧账号 journal 等待租约恢复，绝不使用新账号的动态数据库句柄执行 ack 或回滚。

### 6.2 离线写入

1. 明确检测离线或网络级失败后，事务性写入本机对象与 outbox。
2. journal 保存账号哈希、原 mutation ID、expected revision、完整内容比较、before/after rollback snapshot、尝试次数、lease token 和下一次重试时间。
3. 重连按对象依赖顺序重放；成功前不得清除。多标签 worker 只能用当前 lease token 写回结果，旧 generation 的晚到响应不得覆盖新状态。
4. 100 次相同重放只能生成一个服务端 revision。

### 6.3 多对象事务

单对象 RPC 不足以安全完成删除级联、重排、跨日移动、票据重绑、整批导入、账本批次和组合 AI 操作。P1.3b 已在本地增加首批注册 workflow mutation，但尚未部署或接入产品写路径；客户端仍不能把多对象原子操作拆成若干“看起来成功”的独立写入。当前硬切换门槛在完整 workflow 接入、bootstrap 和双读完成前不可打开。

### 6.4 注册原子 Workflow（本地 Target）

首批注册表只包含 `day.items.reorder@1`、`item.move@1`、`trip.import.commit@1`、`ticket.bind@1`、`ledger.batch@1`、`trip.replan.apply@1` 和 `trip.repair.apply@1`。这不是通用 batch 接口：每个 ID 固定允许的对象类型、操作、最少/最多步骤和拓扑规则；AI 修复不能借此选择任意函数、表、SQL、路由或未登记对象。

`public.account_apply_workflow_v1` 是固定七参数的 `SECURITY INVOKER` 包装。私有实现从 `auth.uid()` 确定 owner/actor，复核账号哈希，拒绝未知字段、重复 step/mutation/object、服务端对象、敏感字段、超限深度/节点/字节和不合法 Ticket 关系。票据重绑还会锁定票据语义身份，并要求旧 metadata 目标及所有现存反向关联都进入同一批次。批次重试先按与单对象 RPC 相同的 object -> mutation 顺序获取 advisory lock，再检查不可读的私有 workflow receipt；所有 revision 与领域规则均在首笔写入前完成，之后对象、单步 receipt 和批次 receipt 在同一 PostgreSQL 事务提交。已完成批次只有在所有对象仍停留在其 applied revision 时才返回 `idempotent`，任一对象已前进则返回 `receipt_advanced` 冲突。

当前迁移 `20260811134000_account_cloud_workflows_v1.sql` 已在本机 Supabase/PostgreSQL 从空库重放，并通过 43 项 pgTAP：实际函数授权/RLS、账号边界、敏感字段、事务异常回滚、100 次顺序幂等回放、advanced receipt、票据关系和跨账号同 ID 隔离。它未应用到 Preview/Production，尚无真实账号 bootstrap、多连接并发、网络不确定性或生产性能收据；本机 reorder/move/import/ticket/ledger/replan/repair 也尚未切换到该 RPC。删除级联和后续对象专用 workflow 必须在另一个有界子阶段补齐，不能用现有 ID 扩权。

## 7. 冲突合同

| 结果 | 使用场景 | 客户端行为 |
| --- | --- | --- |
| 自动合并 | 不同字段、追加集合、可证明独立的状态 | 生成新 mutation，以当前 revision 为 base 提交合并结果 |
| 用户选择 | 同一可编辑字段两端都变更 | 显示短差异，用户选择本机/云端/合并后再提交 |
| 服务端获胜 | server-managed fact/media/job、权限、已撤权成员 | 丢弃本机候选并刷新 cache |
| 不可合并 | 删除与编辑、跨日结构变更、票据互斥绑定、批量事务部分过期 | 保留两端快照，停止自动重试，进入明确修复入口 |

冲突不得通过“最后写入时间更晚”静默覆盖。`updatedAt` 只用于显示与诊断，revision 才是并发控制字段。

## 8. Realtime 与第二设备

`tripmap_account_objects` 使用 `REPLICA IDENTITY FULL` 并加入 `supabase_realtime` publication。客户端订阅必须同时受三层限制：登录 JWT、RLS owner policy、显式 `owner_id=eq.<currentUser>` 查询过滤；读取旅行时再按 `trip_id` 做本地 scope。

删除使用 tombstone UPDATE，而不是物理 DELETE。这避免 Postgres Changes 的 DELETE 过滤限制，也让离线设备能看见删除 revision。收到事件后：

1. 校验 row schema、owner 会话、对象类型、payload 和 revision。
2. revision 小于等于本机 durable revision 时忽略。
3. 本机无 pending mutation 时直接更新 cache。
4. 本机有 pending mutation时保留远端 row，进入冲突/重放协调器。
5. 登出、账号切换、trip 撤权或 token 失效时立即 unsubscribe 并清理账号内存态。

Postgres Changes 适用于 Limited Beta 的低并发阶段。达到约 3,000 同表并发订阅前，P13 必须根据实测吞吐决定迁移到 Supabase Broadcast；不能在未测量时宣称无限扩展。

## 9. 恢复、导出与删除

空设备恢复顺序：账号索引 -> trip -> day/item -> booking/lodging/insurance -> ticket/document metadata -> ledger/intelligence/task ->必要附件索引。Blob 和加密 vault 按权限与按需策略另行恢复，不能塞入通用对象 payload。

恢复必须记录游标、对象数、最大 revision、失败对象和重试状态。单对象损坏不得阻塞其余旅行；损坏对象进入可诊断 quarantine，不能被当作空值覆盖。

P1.5 需要补齐：

- tombstone 默认保留 30 天，用户可恢复；到期后后台硬删除。
- mutation receipt 至少覆盖 outbox 最大寿命和跨设备重放窗口，建议 180 天；清理前先验证无待重放客户端版本。
- 账号导出包含版本 manifest、对象、revision、hash、关系和附件清单，不包含服务端 secret。
- 账号删除先撤销 session/共享权限，再删除 Storage/vault/object/receipt，最后删除 Auth user；生成不含私密正文的完成收据。

## 10. 迁移与发布顺序

### P1.1 合同与增量 schema

- CLI 创建 migration。
- 新表、新 RPC、新 receipt、新 Realtime publication。
- 只复制兼容 legacy rows；不更新或删除 legacy 表。
- 客户端仅包含未启用 adapter 和严格解析器。

### P1.2 本地 mutation runtime（当前分支已完成）

- IndexedDB v11 增加账号隔离的 revision receipt 和 mutation journal。
- coordinator 实现原 mutation 重放、租约 generation、退避、认证恢复、冲突快照、账号数据库绑定、依赖链原子回滚和不确定响应保护；终态 journal 携带回滚完成标记，启动恢复器只补偿未完成终态，避免崩溃窗口和重复回滚。
- Trip/Day/Item 的创建与简单更新已接入受限 adapter；未 bootstrap 的旧对象继续走 legacy，Ticket 与所有多对象操作不进入 V2。
- Ticket 的通用构建器、合同解析器、SQL RPC 和 legacy 回填均执行同一最小字段白名单；完整 Ticket 读写、Blob 与重绑协议仍未接入 V2。
- `ACCOUNT_CLOUD_V2_FULL_CUTOVER_READY` 固定为 `false`；即使环境变量和白名单被设置，也不能启用 V2 写入。
- migration 仍未应用，当前生产数据语义和 UI 均未变化。

### P1.3 Preview、bootstrap 与完整写入面

- 在 Supabase Preview 应用 migration，验证账号哈希 guard、RPC、RLS、grants、Realtime publication、并发幂等、advisors 和回滚。
- 本地 P1.3a 已增加固定表/固定字段、RLS 依赖、Supabase 会话账号哈希复核、有界分页和严格 snake-case 解码；两次完整读取必须一致后才进入 bootstrap。
- 本地 P1.3a 已比较 legacy 与 V2，区分 exact、local-only、remote-only、payload/tombstone/schema drift、unsupported 和 pending mutation。持久化在同一 IndexedDB 事务内重新读取对象与两类 outbox，只为完全一致的 live row 或本机确实不存在的 tombstone 写 revision receipt，绝不改业务对象；Ticket 比较继续使用最小字段白名单。
- `ACCOUNT_CLOUD_V2_SHADOW_READ_READY` 与完整写入门槛一样固定为 `false`。Preview 应用后仍需取得真实账号双读、漂移和 bootstrap 收据，才可逐账号开启 shadow。
- 本地已增加重排、跨日移动、票据重绑、导入、账本、replan 与 AI repair 的首批注册 workflow RPC；继续补齐删除级联、对象专用 codec、本机原子 journal/rollback 接入和 Preview 并发/回滚收据。
- 完成 Ticket 的专用读写/Blob/重绑协议，并为 Document、Booking、Lodging、Insurance 和 Ledger 建立专用 write/read codec；任何本机路径、签名 URL、自由文本秘密和正文不得进入通用表。
- 完成字段冲突策略和用户可见恢复入口后，才允许 Preview 白名单解除代码硬门槛。

### P1.4 Realtime 与完整恢复

- 第二设备订阅、断线续订、token refresh、跨标签登出和账号切换。
- 空设备恢复、tombstone、权限变化和 AI job 进度。
- 连续 7 天 shadow compare 无数据差异后停止 legacy 双写。

### P1.5 生命周期与生产切换

- export/delete/retention/recovery 完成。
- RLS、越权、advisors、性能、100 次幂等、离线收敛、2 秒 SLO 全部通过。
- 分 1% -> 10% -> 50% -> 100% 账号启用；每档保留自动回退阈值。
- legacy 表只读保留至少一个兼容版本周期，再通过独立 migration 归档。

## 11. 回退策略

P1.1-P1.2 回退无需生产动作：代码硬门槛关闭、migration 未应用、legacy 路径未改变。禁止为回退删除未来已写入的 V2 数据。

Preview 启用以后若错误率、冲突率或恢复失败超过阈值：停止新 V2 mutation，保留 V2 只读与 journal，继续收集差异；只有已确认没有 V2-only revision 时才可暂时恢复 legacy 写入。任何双向复制都必须以 revision 和 receipt 为依据，不能使用盲 upsert。

## 12. 必须通过的验证

数据库：

- anon 调用 RPC、读取表、读 receipt：拒绝。
- 用户 A 读取/修改用户 B 对象：拒绝。
- A 账号数据库携带 B token，或账号在 RPC 中途切换：`account_context_mismatch`，不写任一账号。
- RPC 返回期间切换到另一账号：旧账号乐观对象/journal 保留待重放，新账号同 ID 对象不被读取、ack 或回滚。
- authenticated 直接 INSERT/UPDATE/DELETE：拒绝；自己的 SELECT：允许。
- 同 mutation 同内容并发 100 次：一个 revision、一个 receipt。
- 同 mutation 不同内容：`mutation_id_reused`，对象不变。
- 两个 mutation 同 expected revision：一个 applied、一个 conflict。
- tombstone、恢复、旧 retry、对象跨 trip 替换、server-managed 写入：符合合同。
- legacy 回填前后行数/hash 对账，legacy 表零修改。
- Security/Performance Advisors 无新高风险项。

客户端：

- unknown field/type/status、owner/actor 注入、敏感 key、超大/循环 payload、跨对象响应全部拒绝。
- 网络错误进入 outbox；权限/合同错误不重试；成功前 outbox 不清除。
- 模拟终态落盘后崩溃：下次启动只补偿尚未标记完成的 rollback；已回滚冲突不会重复应用。
- 响应丢失、未知 5xx/429、格式损坏：保留同一 mutation ID；advanced idempotent 不覆盖陈旧业务表。
- 多标签 lease 过期后，旧 generation 的 applied/conflict/error 响应都不能修改新 generation 状态。
- 离线乐观写入在页面重载后收到 conflict/permission/rejected 时，完整依赖链可回滚且不留下隐藏重放。
- 第二设备 P95 2 秒内更新；断网编辑重连后收敛。
- 清空 IndexedDB 后正式账号恢复所有用户可见对象和必要附件。

当前本地入口：

```bash
npm run check:account-cloud-migration
npx vitest run src/lib/accountCloud scripts/lib/account-cloud-migration.test.mjs
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Preview/Production 应用、真实 RLS 和跨设备收据尚未完成，因此本文件和 capability manifest 在此阶段不得把云端事实源或 Realtime 标记为 `Current`。
