# trip-plan 示例

这些示例用于外部 AI、旧工具或批量迁移生成旅图 `trip-plan.json` 时参考。它们是兼容格式示例；日常使用应优先通过旅图在线 AI Action Gateway 直接规划、查证并执行旅行任务。

- `trip-plan-basic.json`：基础行程、坐标和交通段。
- `trip-plan-with-reference-external.json`：reference / external 票据和 `bindTo` 绑定示例。
- `trip-plan-copy-package.json`：zip 行程包中的 `trip-plan.json` 示例，copy 附件必须放在 zip 的 `files/` 目录。

注意：

- JSON 单文件不支持 `storageMode: "copy"`。
- copy 票据只能在 `trip-plan.zip` 中使用，`filePath` 必须是 `files/` 下的安全相对路径。
- AI 生成内容需要人工核对地点、坐标、时间和交通备注。
