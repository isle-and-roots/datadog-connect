# Stack Detection Rules

環境ファイルのパターンからインフラ構成を推定するルール集。

## ファイルパターン → インフラ検出

### クラウドプロバイダー

| ファイル/ディレクトリ | 検出内容 |
|---------------------|---------|
| `terraform/` + `aws_*` リソース | AWS |
| `terraform/` + `google_*` リソース | GCP |
| `terraform/` + `azurerm_*` リソース | Azure |
| `.aws/` or `aws-exports.js` | AWS (手動設定) |
| `.gcloud/` or `app.yaml` | GCP (App Engine) |
| `azure-pipelines.yml` | Azure DevOps |
| `serverless.yml` | AWS Lambda (Serverless Framework) |
| `cdk.json` or `cdk.ts` | AWS CDK |
| `pulumi.yaml` | Pulumi (クラウド不問) |

### コンテナ・オーケストレーション

| ファイル/ディレクトリ | 検出内容 |
|---------------------|---------|
| `Dockerfile` or `Dockerfile.*` | Docker |
| `docker-compose.yml` or `compose.yaml` | Docker Compose |
| `kubernetes/` or `k8s/` or `manifests/` | Kubernetes |
| `helm/` or `Chart.yaml` | Helm |
| `.github/workflows/*.yml` (ECS デプロイ) | AWS ECS |
| `fly.toml` | Fly.io |
| `railway.toml` | Railway |
| `render.yaml` | Render |
| `vercel.json` | Vercel (Serverless) |

### 言語・フレームワーク

| ファイル | 検出内容 |
|---------|---------|
| `package.json` | Node.js |
| `package.json` + `next.config.*` | Next.js (Web) |
| `package.json` + `express` in deps | Express.js (API) |
| `package.json` + `fastify` in deps | Fastify (API) |
| `requirements.txt` or `pyproject.toml` | Python |
| `pyproject.toml` + `fastapi` in deps | FastAPI |
| `pyproject.toml` + `django` in deps | Django |
| `pom.xml` | Java (Maven) |
| `build.gradle` | Java/Kotlin (Gradle) |
| `go.mod` | Go |
| `Gemfile` | Ruby |
| `Gemfile` + `rails` | Ruby on Rails |
| `composer.json` | PHP |
| `Cargo.toml` | Rust |
| `*.csproj` or `*.sln` | .NET/C# |

### データベース

| ファイル/パターン | 検出内容 |
|----------------|---------|
| `DATABASE_URL=postgres*` in `.env` | PostgreSQL |
| `DATABASE_URL=mysql*` in `.env` | MySQL |
| `REDIS_URL` in `.env` | Redis |
| `MONGODB_URI` in `.env` | MongoDB |
| `docker-compose.yml` に `postgres` サービス | PostgreSQL (local) |
| `docker-compose.yml` に `mysql` サービス | MySQL (local) |
| `drizzle.config.*` or `prisma/schema.prisma` | ORM 使用 (DB 種別は上記で判定) |

### CI/CD

| ファイル | 検出内容 |
|---------|---------|
| `.github/workflows/` | GitHub Actions |
| `.gitlab-ci.yml` | GitLab CI |
| `Jenkinsfile` | Jenkins |
| `.circleci/config.yml` | CircleCI |
| `bitbucket-pipelines.yml` | Bitbucket Pipelines |

## スタックプロファイルの組み合わせ例

| 検出シグナルの組み合わせ | スタックプロファイル |
|------------------------|-------------------|
| Node.js + Docker + AWS terraform | `web-app-aws-nodejs` |
| Next.js + Vercel | `web-app-vercel-nextjs` |
| Python + FastAPI + Docker + GCP | `api-gcp-python` |
| Java + Spring + Kubernetes + AWS | `java-k8s-aws` |
| Go + Docker + AWS ECS | `go-ecs-aws` |
| Ruby on Rails + PostgreSQL + Heroku/Render | `rails-postgres-paas` |
| Node.js + PostgreSQL (Supabase) + Vercel | `web-app-supabase-vercel` |

## 検出コマンド

```bash
# ファイル構造の概要を取得
ls -la
find . -maxdepth 2 -name "*.json" -o -name "*.yaml" -o -name "*.toml" | grep -v node_modules | grep -v .git

# package.json の依存関係確認
cat package.json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d.get('dependencies',{}).keys())[:20])"

# .env ファイルのキー確認（値は表示しない）
grep -oP '^[A-Z_]+(?==)' .env 2>/dev/null | head -20

# terraform リソースタイプ確認
grep -r "^resource" terraform/ 2>/dev/null | grep -oP '"[a-z]+_' | sort -u
```

## 不明な場合の質問テンプレート

自動検出で判定できない場合、以下を確認する:

```markdown
インフラ構成を教えてください:

1. **クラウド**: AWS / GCP / Azure / オンプレ / PaaS (Vercel, Railway, etc.)
2. **コンテナ**: Docker / Kubernetes / なし
3. **言語**: Node.js / Python / Go / Java / Ruby / その他
4. **データベース**: PostgreSQL / MySQL / MongoDB / Redis / なし
5. **トラフィック規模**: 小 (< 1k req/day) / 中 (< 100k) / 大 (> 100k)
```
