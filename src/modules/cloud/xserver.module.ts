import { select, input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual } from "../../utils/prompts.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { DatadogClient } from "../../client/datadog-client.js";
import { writeSecureFile, writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg } from "../../utils/validators.js";

const XSERVER_TYPES = [
  { value: "vps", name: "Xserver VPS" },
  { value: "dedicated", name: "Xserver 専用サーバー" },
  { value: "business", name: "Xserver Business (SSH可)" },
];

interface XserverConfig extends ModuleConfig {
  serverType: string;
  host: string;
  port: number;
  user: string;
  enableProcess: boolean;
  enableNginx: boolean;
  enableMysql: boolean;
  tags: string[];
}

class XserverModule extends BaseModule {
  readonly id = "xserver";
  readonly name = "Xserver (VPS/専用)";
  readonly description = "Xserver VPS・専用サーバーにDatadog Agentをインストール";
  readonly category = "cloud" as const;
  readonly dependencies: string[] = [];

  async prompt(): Promise<XserverConfig> {
    const serverType = await select({
      message: "Xserver プラン:",
      choices: XSERVER_TYPES,
    });

    const host = await input({
      message: "サーバーホスト名 (SSH接続先):",
      validate: (v) => v.trim().length > 0 || "ホスト名を入力してください",
    });

    const portStr = await input({
      message: "SSHポート:",
      default: "22",
      validate: (v) => /^\d+$/.test(v) || "ポート番号を入力してください",
    });
    const port = parseInt(portStr, 10);

    const user = await input({
      message: "SSHユーザー名:",
      default: "root",
    });

    const enableProcess = await confirm({
      message: "プロセス監視を有効にしますか？",
      default: true,
    });

    const enableNginx = await confirm({
      message: "Nginx監視を有効にしますか？",
      default: true,
    });

    const enableMysql = await confirm({
      message: "MySQL/MariaDB監視を有効にしますか？",
      default: false,
    });

    const tags = await promptTags();

    return { serverType, host, port, user, enableProcess, enableNginx, enableMysql, tags };
  }

  async execute(config: XserverConfig): Promise<ExecutionResult> {
    const manualSteps = [];
    const outputDir = getSecureOutputDir();

    // SSH install script
    const installScript = generateXserverInstallScript(config);
    const scriptPath = `${outputDir}/xserver-install.sh`;
    writeExecutableFile(scriptPath, installScript);

    manualSteps.push({
      title: "Xserver に Datadog Agent をインストール",
      description: `SSH経由で${config.host}にDatadog Agentをインストールしてください。`,
      commands: [
        `# ローカルからSSH経由で実行`,
        `ssh -p ${escapeShellArg(String(config.port))} ${escapeShellArg(config.user)}@${escapeShellArg(config.host)} 'bash -s' < ${scriptPath}`,
        ``,
        `# または直接サーバーにログインして実行`,
        `ssh -p ${escapeShellArg(String(config.port))} ${escapeShellArg(config.user)}@${escapeShellArg(config.host)}`,
        `bash ${scriptPath}`,
      ],
      outputFile: scriptPath,
    });

    // Firewall instructions
    manualSteps.push({
      title: "Xserver ファイアウォール設定",
      description: "Datadog Agent がデータを送信するため、以下のポートを開放してください。",
      commands: [
        `# Xserver管理画面 → ファイアウォール設定`,
        `# 以下のアウトバウンドルールを追加:`,
        `# - TCP 443 (HTTPS) → *.datadoghq.com`,
        `# - TCP 443 (HTTPS) → *.logs.datadoghq.com`,
        ``,
        `# iptablesの場合:`,
        `iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT`,
      ],
    });

    // Nginx config
    if (config.enableNginx) {
      const nginxConf = generateNginxConfig();
      const nginxPath = `${outputDir}/nginx.d-conf.yaml`;
      writeSecureFile(nginxPath, nginxConf);

      manualSteps.push({
        title: "Nginx 監視設定",
        description: "/etc/datadog-agent/conf.d/nginx.d/conf.yaml に配置してください。",
        outputFile: nginxPath,
      });
    }

    // MySQL config
    if (config.enableMysql) {
      const mysqlConf = generateMysqlConfig();
      const mysqlPath = `${outputDir}/mysql.d-conf.yaml`;
      writeSecureFile(mysqlPath, mysqlConf);

      manualSteps.push({
        title: "MySQL/MariaDB 監視設定",
        description: "/etc/datadog-agent/conf.d/mysql.d/conf.yaml に配置してください。MySQLにdatadogユーザーの作成も必要です。",
        commands: [
          `mysql -u root -p -e "CREATE USER 'datadog'@'localhost' IDENTIFIED BY '<PASSWORD>';"`,
          `mysql -u root -p -e "GRANT REPLICATION CLIENT, PROCESS ON *.* TO 'datadog'@'localhost';"`,
          `mysql -u root -p -e "GRANT SELECT ON performance_schema.* TO 'datadog'@'localhost';"`,
        ],
        outputFile: mysqlPath,
      });
    }

    printManual(`Xserverインストールスクリプト: ${scriptPath}`);

    return { success: true, resources: [], manualSteps, errors: [] };
  }

  async verify(_client: DatadogClient): Promise<VerificationResult> {
    return {
      success: true,
      checks: [{
        name: "Xserver Agent インストール手順出力確認",
        passed: true,
        detail: "SSH経由でインストール後、Datadog UIでホストを確認してください",
      }],
    };
  }
}

function generateXserverInstallScript(config: XserverConfig): string {
  const tagStr = config.tags.length > 0 ? config.tags.join(",") : "";

  return `#!/bin/bash
# Datadog Agent Install for Xserver (${config.serverType})
# Host: ${config.host}
# Generated by Datadog Connect

set -e

DD_API_KEY="<YOUR_DD_API_KEY>"

echo "=== Xserver Datadog Agent インストール ==="
echo "ホスト: ${escapeShellArg(config.host)}"
echo "タイプ: ${escapeShellArg(config.serverType)}"

# 1. Agent インストール
echo "1. Datadog Agent をインストール中..."
DD_AGENT_MAJOR_VERSION=7 DD_API_KEY="\${DD_API_KEY}" \\
  ${tagStr ? `DD_HOST_TAGS="${escapeShellArg(tagStr)}" \\` : ""}
  bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script_agent7.sh)"

# 2. 追加設定
${config.enableProcess ? `echo "2. プロセス監視を有効化..."
cat >> /etc/datadog-agent/datadog.yaml << 'EOF'

process_config:
  process_collection:
    enabled: true
EOF` : ""}

# 3. Agent 再起動
echo "3. Agent を再起動中..."
systemctl restart datadog-agent

# 4. ステータス確認
echo ""
echo "=== インストール完了 ==="
datadog-agent status 2>/dev/null | head -30 || echo "Agent起動待ち..."

echo ""
echo "Datadog UIでホスト「$(hostname)」が表示されることを確認してください。"
`;
}

function generateNginxConfig(): string {
  return `# Nginx Datadog Integration
# Place at: /etc/datadog-agent/conf.d/nginx.d/conf.yaml

init_config:

instances:
  - nginx_status_url: http://localhost/nginx_status
    tags:
      - managed:datadog-connect

# Nginx側でstub_statusを有効にする必要があります:
# server {
#   listen 80;
#   server_name localhost;
#   location /nginx_status {
#     stub_status on;
#     allow 127.0.0.1;
#     deny all;
#   }
# }
`;
}

function generateMysqlConfig(): string {
  return `# MySQL Datadog Integration
# Place at: /etc/datadog-agent/conf.d/mysql.d/conf.yaml

init_config:

instances:
  - host: 127.0.0.1
    username: datadog
    password: "<DATADOG_USER_PASSWORD>"
    port: 3306
    options:
      replication: false
      galera_cluster: false
      extra_status_metrics: true
      extra_innodb_metrics: true
      schema_size_metrics: true
    tags:
      - managed:datadog-connect
`;
}

registerModule(new XserverModule());
