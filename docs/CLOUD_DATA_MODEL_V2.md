# TripMap Account Cloud V2

更新时间：2026-08-11

状态：**Target；P1.1 已在当前分支实现本地合同和增量 migration，尚未应用到 Supabase Preview 或 Production**

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

| 范围 | 当前生产事实 | V2 目标 | 当前分支 P1.1 |
| --- | --- | --- | --- |
| 对象写入 | IndexedDB 首写，稍后 upsert `cloud_sync_objects` | 在线 cloud-first，离线才排队 | 新 RPC 和客户端合同已写，本地旧路径未切换 |
| 幂等 | 当前行保留 `op_id` | 独立 mutation receipt 永久识别已完成请求 | migration 已包含私有 receipt ledger |
| 并发 | `updated_at_ms` 与本地三方合并 | 单调 revision、字段策略、结构化冲突 | revision 和冲突结果已定义，字段合并待 P1.2 |
| 删除 | `deleted_at_ms` | Realtime 可过滤的 tombstone UPDATE | 新表使用 payload 为空的 tombstone |
| Realtime | 核心旅行对象未发布 | 按 owner/trip 收敛对象和 job | migration 已声明 publication，订阅待 P1.3 |
| 恢复 | 旅行级手工恢复 | 空设备自动恢复完整账号索引与旅行 | 回填存在，恢复编排待 P1.3 |
| 私密资料 | 独立加密 vault 和 Storage | 继续分域，只同步最小索引 | V2 明确禁止正文、OCR、Blob、Token 和密钥 |

## 3. 正式对象目录

所有对象都使用同一版本化 envelope，但 payload 仍由对象自己的合同约束。`client_mutable` 表示登录用户可以通过 revision RPC 写入；`server_managed` 表示浏览器只能读取，正式写入必须来自受控服务端流程。

| objectType | Payload contract | 写权限 | 内容边界 |
| --- | --- | --- | --- |
| `trip` | `TripV1` | client mutable | 标题、目的地、日期、时区和用户备注 |
| `day` | `DayV1` | client mutable | 日期、标题、时区和排序 |
| `item` | `ItineraryItemV1` | client mutable | 时间、地点、坐标、交通、执行状态和票据引用 |
| `ticket_meta` | `TicketMetaV1` | client mutable | 最小文件 metadata、分类、结构化字段和关系；不含 Blob |
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

客户端请求只包含：

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

请求明确不含 `ownerId`、`actorId`、SQL、表名、函数名、路由、任意控制面 URL、Blob、Token、Provider key、OCR 正文或 raw Provider payload。

RPC 固定执行顺序：

1. 从 JWT 读取 actor/owner，拒绝未认证调用。
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
3. 调用 V2 RPC；此时 outbox 仍为空。
4. `applied/idempotent` 后把返回对象写入 IndexedDB cache，并保存 revision receipt。
5. `conflict` 进入字段策略；UI 不得显示“已保存”。
6. 认证、权限、合同错误回滚 optimistic state；可恢复网络错误才进入 outbox。

### 6.2 离线写入

1. 明确检测离线或网络级失败后，事务性写入本机对象与 outbox。
2. outbox 保存原 mutation ID、expected revision、payload hash、尝试次数和下一次重试时间。
3. 重连按 trip 和依赖顺序重放；成功前不得清除。
4. 100 次相同重放只能生成一个服务端 revision。

### 6.3 多对象事务

单对象 RPC 不足以安全完成重排、跨日移动、整批导入和组合 AI 操作。P1.2 必须增加注册 workflow mutation：服务端在一个事务中校验所有对象 revision，再全部写入或全部拒绝。客户端不能把多对象原子操作拆成若干“看起来成功”的独立写入。

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

P1.4 需要补齐：

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

### P1.2 双读、cloud-first 单写

- feature flag 仅对白名单测试账号启用。
- 首次读取比较 legacy 与 V2，记录 drift，不自动覆盖。
- 在线单对象写改走 V2；网络错误才进入 V2 outbox。
- 多对象 workflow RPC、字段合并和 durable revision cache 同批落地。

### P1.3 Realtime 与完整恢复

- 第二设备订阅、断线续订、token refresh、跨标签登出和账号切换。
- 空设备恢复、tombstone、权限变化和 AI job 进度。
- 连续 7 天 shadow compare 无数据差异后停止 legacy 双写。

### P1.4 生命周期与生产切换

- export/delete/retention/recovery 完成。
- RLS、越权、advisors、性能、100 次幂等、离线收敛、2 秒 SLO 全部通过。
- 分 1% -> 10% -> 50% -> 100% 账号启用；每档保留自动回退阈值。
- legacy 表只读保留至少一个兼容版本周期，再通过独立 migration 归档。

## 11. 回退策略

P1.1 回退只需停止客户端 flag；新表是增量的，legacy 路径未改变。禁止为回退删除已写入的 V2 数据。

P1.2 以后若错误率、冲突率或恢复失败超过阈值：停止新 V2 mutation，保留 V2 只读与 outbox，继续收集差异；只有已确认没有 V2-only revision 时才可暂时恢复 legacy 写入。任何双向复制都必须以 revision 和 receipt 为依据，不能使用盲 upsert。

## 12. 必须通过的验证

数据库：

- anon 调用 RPC、读取表、读 receipt：拒绝。
- 用户 A 读取/修改用户 B 对象：拒绝。
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
