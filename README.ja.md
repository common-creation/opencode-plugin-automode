# @common-creation/opencode-plugin-automode

[OpenCode](https://opencode.ai) のシェルツールに対する安全分類器として動作するプラグインです。実行前にすべてのコマンドを LLM で判定し、安全なコマンドは許可、危険なコマンドは拒否します。

**OpenCode 1.x と OpenCode 2.x (beta) の両方**に単一パッケージで対応しています。同じモジュールが V1 用の `server` エントリポイントと V2 用の `setup` エントリポイントを公開し、各バージョンのローダーが自分の理解できる方を採用します。

> **English version is here**: [README.md](README.md)

## 動作の仕組み

1. プラグインは `tool.execute.before` フックでシェル呼び出し(OpenCode 1.x では `bash`、2.x では `shell`)をすべて傍受します。
2. コマンドを「安全か危険か」を定義したシステムプロンプトとともに LLM に送信します。
3. LLM は JSON で判定を返します: `{"allowed": true|false, "reason": "..."}`
4. `allowed: true` → コマンドはそのまま実行されます。
5. `allowed: false` → ツール呼び出しがエラーで拒否されます（ユーザーの介入なしでエージェントが対応できます）。

判定は使い捨ての専用セッションで実行され、毎回削除されます（OpenCode 2.x ではベストエフォート）。分類セッションはツールを一切呼び出せません: V1 ではリクエスト時に明示的に無効化し、V2 ではセッションヘックが分類用システムプロンプトを固定し、モデル dispatch 前にすべてのツールを剥奪します。

## インストール

### OpenCode 1.x

CLI でインストール:

```sh
opencode plugin add @common-creation/opencode-plugin-automode
```

または手動で追加:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@common-creation/opencode-plugin-automode"]
}
```

### OpenCode 2.x (beta)

OpenCode 2 プラグイン API beta が必要です。CLI でインストール:

```sh
opencode2 plugin add @common-creation/opencode-plugin-automode
```

または手動で追加:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["@common-creation/opencode-plugin-automode"]
}
```

ローカルビルドはどちらのバージョンでもパス指定で読み込めます。
例: `"plugin"/"plugins": ["./node_modules/@common-creation/opencode-plugin-automode/dist/index.js"]`

### バージョン間の違い

| | OpenCode 1.x | OpenCode 2.x (beta) |
|---|---|---|
| 対象ツール | `bash` | `shell` |
| モデル解決 | 呼び出し元セッション → 設定 → なし | `OPENCODE_AUTOMODE_MODEL` 環境変数 → カタログ既定 |
| サーバーログ | `app.log` | ファイルログのみ |
| 分類セッションの削除 | 削除される | ベストエフォート (`session.remove`) |

## 設定

環境変数はプラグインまで届かない場合があります。OpenCode 2.x はサーバーをバックグラウンドサービスとして起動し、その環境はたまたま起動した親プロセスに依存するためです。設定エントリと一緒に渡されるプラグインオプションの利用を推奨します:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "@common-creation/opencode-plugin-automode",
      "options": {
        "environment": {
          "OPENCODE_AUTOMODE_LOG_PATH": "/tmp/automode.log"
        }
      }
    }
  ]
}
```

`options.environment` のキーは `OPENCODE_AUTOMODE_*` 変数のみ有効です。スネークケースの直接指定も可能で、こちらが最優先されます（次いで `environment` マップ、最後に実際の環境変数）:

```json
{ "package": "@common-creation/opencode-plugin-automode", "options": { "log_path": "/tmp/automode.log" } }
```

`log_path` は先頭の `~` をユーザーのホームディレクトリとして解決します（OpenCodeはWindowsで直接実行できるため、`/` と `\` 両方の区切り文字に対応）。これによりOpenCode本体のログと同じディレクトリにも置けます:

```json
{ "package": "@common-creation/opencode-plugin-automode", "options": { "log_path": "~/.local/share/opencode/log/automode.log" } }
```

ファイルロガーはレベルに関係なくすべての出力(`debug`/`info`/`warn`/`error`)をJSONLで書き出します。レベルフィルタはありません。

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
bun test            # ユニットテスト（JSON パーサー、ロガー、分類エンジン）
bun run scripts/manual-test.ts  # サーバーを起動して安全/危険コマンド群を分類
```

手動テストは誤分類があると非ゼロで終了します。動作する OpenCode と認証設定が必要です。分類モデルは `OPENCODE_AUTOMODE_MODEL` で指定できます（デフォルト: `opencode-go/deepseek-v4-flash`）。

## ライセンス

MIT
