import { select, input, confirm } from "@inquirer/prompts";
import { BaseModule } from "../base-module.js";
import { registerModule } from "../registry.js";
import { promptTags } from "../shared/tags.js";
import { printManual, printInfo, printSuccess } from "../../utils/prompts.js";
import {
  XSERVER_TYPES,
  XSERVER_FIREWALL_RULES,
  XSERVER_NGINX_CONFIG,
  XSERVER_MYSQL_CONFIG,
  XSERVER_MYSQL_GRANTS,
  generateXserverInstallScript,
} from "../../knowledge/cloud-configs.js";
import type { ModuleConfig, ExecutionResult, VerificationResult } from "../../config/types.js";
import type { ModulePlan, McpToolCall } from "../../orchestrator/mcp-call.js";
import { writeSecureFile, writeExecutableFile, getSecureOutputDir } from "../../utils/secure-write.js";
import { escapeShellArg } from "../../utils/validators.js";
import { getBrowserController } from "../../browser/browser-controller.js";
import { authenticateXserver, fetchXserverVpsList, configureXserverFirewall } from "../../browser/xserver-browser.js";

interface XserverConfig extends ModuleConfig {
  serverType: string;
  host: string;
  port: number;
  user: string;
  enableProcess: boolean;
  enableNginx: boolean;
  enableMysql: boolean;
  tags: string[];
  usedBrowser: boolean;
  vpsId: string;
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

    let host = "";
    let port = 22;
    let user = "root";
    let usedBrowser = false;
    let vpsId = "";

    // ブラウザ自動取得オプション
    const browserCtrl = getBrowserController();
    if (await browserCtrl.isAvailable()) {
      const useBrowser = await confirm({
        message: "ブラウザで Xserver の情報を自動取得しますか？",
        default: true,
      });

      if (useBrowser) {
        const ready = await browserCtrl.ensureBrowser();
        if (ready) {
          await browserCtrl.launch();
          const loggedIn = await authenticateXserver(browserCtrl);

          if (loggedIn) {
            const vpsList = await fetchXserverVpsList(browserCtrl);

            if (vpsList.length > 0) {
              // VPS選択
              const selectedVps = await select({
                message: "対象サーバーを選択:",
                choices: vpsList.map((v) => ({
                  value: v,
                  name: `${v.id || v.ip} — ${v.hostname || v.ip}${v.status === "running" ? " (稼働中)" : ""}`,
                })),
              });

              host = selectedVps.ip || selectedVps.hostname;
              vpsId = selectedVps.id;
              usedBrowser = true;
              printSuccess(`SSH接続先: ${host}`);
              // ブラウザはexecute()のFW設定で再利用するため開いたまま
            } else {
              printInfo("VPS情報を自動取得できませんでした。手動で入力してください。");
              await browserCtrl.close();
            }
          } else {
            await browserCtrl.close();
          }

          // ブラウザを使わない場合（VPS取得失敗 or ログイン失敗）は確実にclose
          if (!usedBrowser && browserCtrl.getPage()) {
            await browserCtrl.close();
          }
        }
      }
    }

    // ブラウザで取得できなかった場合は手動入力
    if (!host) {
      host = await input({
        message: "サーバーホスト名 (SSH接続先):",
        validate: (v) => v.trim().length > 0 || "ホスト名を入力してください",
      });
    }

    const portStr = await input({
      message: "SSHポート:",
      default: "22",
      validate: (v) => {
        const n = parseInt(v, 10);
        return (/^\d+$/.test(v) && n >= 1 && n <= 65535) || "ポート番号は1〜65535で入力してください";
      },
    });
    port = parseInt(portStr, 10);

    user = await input({
      message: "SSHユーザー名:",
      default: "root",
    });

    const enableProcess = await confirm({
      message: "プロセス監視を有効にしますか？",
      default: true,
    });

    const enableNginx = await confirm({
      message: "Nginx監視を有効にしますか？ (Nginxがインストール済みの場合のみ)",
      default: false,
    });

    const enableMysql = await confirm({
      message: "MySQL/MariaDB監視を有効にしますか？",
      default: false,
    });

    const tags = await promptTags();

    return { serverType, host, port, user, enableProcess, enableNginx, enableMysql, tags, usedBrowser, vpsId };
  }

  plan(config: ModuleConfig): ModulePlan {
    const xsConfig = config as XserverConfig;
    const calls: McpToolCall[] = [];
    const verificationCalls: McpToolCall[] = [];

    const serverType = xsConfig.serverType ?? "vps";
    const host = xsConfig.host ?? "<XSERVER_HOST>";
    const port = xsConfig.port ?? 22;
    const user = xsConfig.user ?? "root";
    const tags = xsConfig.tags ?? [];
    const enableProcess = xsConfig.enableProcess ?? true;
    const enableNginx = xsConfig.enableNginx ?? false;
    const enableMysql = xsConfig.enableMysql ?? false;

    const flags = { enableProcess, enableNginx, enableMysql };

    // Xserver setup is entirely manual (SSH-based agent install on VPS/dedicated server)
    const manualSteps = [];

    // Install script
    const installScript = generateXserverInstallScript(serverType, host, tags, flags);
    manualSteps.push({
      title: `Xserver (${serverType}) に Datadog Agent をインストール`,
      description:
        `SSH 経由でホスト ${host} に Datadog Agent をインストールします。` +
        "<YOUR_DD_API_KEY> を実際の API キーに置き換えてください。",
      commands: [
        `# ローカルから SSH 経由で実行`,
        `ssh -p ${port} ${user}@${host} 'bash -s' < xserver-install.sh`,
        ``,
        `# または直接サーバーにログインして実行`,
        `ssh -p ${port} ${user}@${host}`,
        `bash xserver-install.sh`,
      ],
      outputFile: "xserver-install.sh",
    });
    manualSteps.push({
      title: "Xserver インストールスクリプト内容",
      description: installScript,
    });

    // Firewall configuration
    const firewallRulesSummary = XSERVER_FIREWALL_RULES
      .map((r) => `${r.protocol} ${r.port} → ${r.destination} (${r.description})`)
      .join("\n");
    manualSteps.push({
      title: "Xserver ファイアウォール設定",
      description:
        "Xserver 管理画面のファイアウォール設定で以下のアウトバウンドルールを追加してください:\n" +
        firewallRulesSummary,
      commands: [
        `# iptables を使う場合:`,
        `iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT`,
      ],
    });

    // Nginx integration config
    if (enableNginx) {
      manualSteps.push({
        title: "Nginx 監視設定",
        description:
          "/etc/datadog-agent/conf.d/nginx.d/conf.yaml に以下の内容を配置してください。" +
          "Nginx の stub_status が有効になっている必要があります。",
        outputFile: "nginx.d-conf.yaml",
      });
      manualSteps.push({
        title: "Nginx 監視設定ファイル内容",
        description: XSERVER_NGINX_CONFIG,
      });
    }

    // MySQL integration config
    if (enableMysql) {
      manualSteps.push({
        title: "MySQL/MariaDB 監視設定",
        description:
          "/etc/datadog-agent/conf.d/mysql.d/conf.yaml に以下の内容を配置してください。" +
          "また、Datadog 監視用 MySQL ユーザーの作成が必要です。",
        commands: [
          `mysql -u root -p -e "CREATE USER 'datadog'@'localhost' IDENTIFIED BY '<PASSWORD>';"`,
          ...XSERVER_MYSQL_GRANTS.map((g) => `mysql -u root -p -e "${g}"`),
        ],
        outputFile: "mysql.d-conf.yaml",
      });
      manualSteps.push({
        title: "MySQL 監視設定ファイル内容",
        description: XSERVER_MYSQL_CONFIG,
      });
    }

    // Verification: check host appears in Datadog
    verificationCalls.push({
      id: "verify_xserver_host",
      tool: "datadog_list_hosts",
      parameters: {
        filter: tags.length > 0 ? tags[0] : `host:${host}`,
      },
      description: `Datadog でホスト ${host} が登録されているか確認`,
    });

    return {
      moduleId: this.id,
      moduleName: this.name,
      category: this.category,
      calls,
      manualSteps,
      verificationCalls,
    };
  }

  async execute(config: XserverConfig): Promise<ExecutionResult> {
    const manualSteps = [];
    const outputDir = getSecureOutputDir();

    // SSH install script
    const installScript = generateXserverInstallScript(
      config.serverType,
      config.host,
      config.tags,
      { enableProcess: config.enableProcess, enableNginx: config.enableNginx, enableMysql: config.enableMysql }
    );
    const scriptPath = `${outputDir}/xserver-install.sh`;
    writeExecutableFile(scriptPath, installScript);

    manualSteps.push({
      title: "Xserver に Datadog Agent をインストール",
      description: `SSH経由で${config.host}にDatadog Agentをインストールしてください。`,
      commands: [
        `# ローカルからSSH経由で実行`,
        `ssh -p ${escapeShellArg(String(config.port))} ${escapeShellArg(config.user)}@${escapeShellArg(config.host)} 'bash -s' < ${escapeShellArg(scriptPath)}`,
        ``,
        `# または直接サーバーにログインして実行`,
        `ssh -p ${escapeShellArg(String(config.port))} ${escapeShellArg(config.user)}@${escapeShellArg(config.host)}`,
        `bash ${escapeShellArg(scriptPath)}`,
      ],
      outputFile: scriptPath,
    });

    // Firewall: ブラウザ自動設定 or 手動手順
    let firewallConfigured = false;
    if (config.usedBrowser && config.vpsId) {
      const browserCtrl = getBrowserController();
      try {
        if (browserCtrl.getPage()) {
          firewallConfigured = await configureXserverFirewall(browserCtrl, config.vpsId);
        }
      } catch {
        printInfo("ファイアウォール自動設定に失敗しました。手動設定に切り替えます。");
      } finally {
        // ブラウザを確実にクリーンアップ
        await browserCtrl.close();
      }
    }

    if (!firewallConfigured) {
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
    }

    // Nginx config
    if (config.enableNginx) {
      const nginxConf = XSERVER_NGINX_CONFIG;
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
      const mysqlConf = XSERVER_MYSQL_CONFIG;
      const mysqlPath = `${outputDir}/mysql.d-conf.yaml`;
      writeSecureFile(mysqlPath, mysqlConf);

      manualSteps.push({
        title: "MySQL/MariaDB 監視設定",
        description: "/etc/datadog-agent/conf.d/mysql.d/conf.yaml に配置してください。MySQLにdatadogユーザーの作成も必要です。",
        commands: [
          `mysql -u root -p -e "CREATE USER 'datadog'@'localhost' IDENTIFIED BY '<PASSWORD>';"`,
          ...XSERVER_MYSQL_GRANTS.map((g) => `mysql -u root -p -e "${g}"`),
        ],
        outputFile: mysqlPath,
      });
    }

    printManual(`Xserverインストールスクリプト: ${scriptPath}`);

    return { success: true, resources: [], manualSteps, errors: [] };
  }

  async verify(_client: unknown): Promise<VerificationResult> {
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

registerModule(new XserverModule());
