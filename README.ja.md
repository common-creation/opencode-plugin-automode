# @common-creation/opencode-plugin-automode

[OpenCode](https://opencode.ai) の `bash` ツールに対する安全分類器として動作するプラグインです。実行前にすべての bash コマンドを LLM で判定し、安全なコマンドは許可、危険なコマンドは拒否します。

> **English version is here**: [README.md](README.md)

## 動作の仕組み

1. プラグインは `tool.execute.before` フックで `bash` の呼び出しをすべて傍受します。
2. コマンドを「安全か危険か」を定義したシステムプロンプトとともに、`@opencode-ai/sdk` のクライアント経由で LLM に送信します。
3. LLM は JSON で判定を返します: `{"allowed": true|false, "reason": "..."}`
4. `allowed: true` → コマンドはそのまま実行されます。
5. `allowed: false` → ツール呼び出しがエラーで拒否されます（ユーザーの介入なしでエージェントが対応できます）。

判定は使い捨ての専用セッションで実行され、毎回削除されます。分類セッションは `bash`・`edit`・`write`・`create`・`delete`・`webfetch`・`task` を呼び出せません。

## インストール

npm プラグインとして:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@common-creation/opencode-plugin-automode"]
}
```

またはローカルのビルド成果物（例: `dist/index.js`）を `opencode.json` のパス指定で直接読み込むこともできます。

## 設定

| 環境変数 | デフォルト | 説明 |
|---|---|---|
| `OPENCODE_AUTOMODE_ENABLED` | `true` | `false` にするとプラグイン全体を無効化します。 |
| `OPENCODE_AUTOMODE_MODEL` | *(自動)* | 分類に使うモデル（`provider/model` 形式、例: `opencode-go/deepseek-v4-flash`）。未指定時は呼び出し元セッションのモデル、次いで設定済みデフォルトモデルを使用します。 |
| `OPENCODE_AUTOMODE_FAIL_MODE` | `closed` | `closed` = 分類が失敗・タイムアウトしたらブロック（フェイルクローズド）。`open` = その場合は許可（フェイルオープン）。 |
| `OPENCODE_AUTOMODE_TIMEOUT_MS` | `30000` | 1回の分類呼び出しのタイムアウト。 |
| `OPENCODE_AUTOMODE_MAX_RETRIES` | `2` | 分類応答が不正な JSON だった場合の追加試行回数。 |
| `OPENCODE_AUTOMODE_LOG_PATH` | *(空)* | プラグインのログを書き出すファイルパス（1行1つの JSON オブジェクト）。空の場合はファイルログを無効化します。 |

## セキュリティ上の注意

- これは**サンドボックスではなくガードレール**です。悪意のあるエージェントやプロンプトインジェクションそのものは防げません。
- 分類器には素のコマンドだけが渡ります（アシスタントの文章やツール出力は含まれない）。これにより、分類器への「言い訳」やプロンプトインジェクションの余地を減らします。
- プロジェクト外のパスに触れるコマンドは、引き続き OpenCode 自身の権限システム（`external_directory` プロンプトなど）の対象です。
- プロジェクト内の破壊的操作（例: プロジェクト内サブディレクトリへの `rm -rf`）は通常の開発クリーンアップとして安全判定される場合があります。脅威モデルに応じて期待値を調整してください。

## 開発

```sh
bun install
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
bun test            # JSON パーサーのユニットテスト
bun run scripts/manual-test.ts  # サーバーを起動して安全/危険コマンド群を分類
```

手動テストは誤分類があると非ゼロで終了します。動作する OpenCode と認証設定が必要です。分類モデルは `AUTOMODE_MODEL` で指定できます（デフォルト: `opencode-go/deepseek-v4-flash`）。

## ライセンス

MIT
