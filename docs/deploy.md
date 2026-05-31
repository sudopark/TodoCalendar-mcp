# 배포 절차

CI/CD 자동화 없음 — npm publish + Cloud Run 둘 다 작업자가 수동. 한 릴리스에서 두 산출물(`todocalendar-tools` lib + `todocalendar-mcp` server)이 같이 나가는 게 원칙. 버전은 둘 다 동일하게 맞춘다.

## 사전 조건

### 인증

```bash
npm whoami                                   # npmjs.com 로그인 (401이면 npm adduser)
gcloud config list                           # account / project 확인
gcloud auth configure-docker us-central1-docker.pkg.dev   # 최초 1회
```

### 환경 변수 placeholder

문서 안에서 다음 값들을 쓰는 자리는 `gcloud config`에서 꺼내 채우거나 직접 export 해두고 명령에 넣는다.

```bash
export PROJECT_ID=$(gcloud config get-value project)        # GCP project id
export REGION=us-central1                                    # Cloud Run / Artifact Registry region
export SERVICE=todocalendar-mcp                              # Cloud Run service name
export REPO=todocalendar-mcp                                 # Artifact Registry repo
export IMAGE_BASE=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/server
```

## 릴리스 순서

### 1. 버전 결정 + 커밋

`package.json`만 손대고 `package-lock.json`은 `npm version`이 같이 갱신.

```bash
npm version <new-version> --no-git-tag-version
git add package.json package-lock.json
git commit -m "release <new-version>"
```

태그는 push 직후에 (아래 step 2).

### 2. develop push

```bash
git push origin develop
```

> 태그는 여기서 안 박는다. 배포 끝나고 develop → master 머지된 다음에 master 위에서 박는다 (아래 §6).

### 3. npm publish (lib 산출물)

`prepublishOnly` 훅 없음 — build 수동 선행.

```bash
npm run build                                # dist/ 갱신
npm publish --access public                  # OTP 프롬프트 → 2FA 입력
```

`--access public`은 unscoped 패키지라 필수 (빼면 403). 패키지명은 `todocalendar-tools` (npmjs.com).

확인:

```bash
npm view todocalendar-tools version          # 새 버전 노출 확인
```

### 4. Cloud Run 빌드 + 배포 (server 산출물)

#### 4-1. Cloud Build로 이미지 빌드 + Artifact Registry push

```bash
gcloud builds submit --tag ${IMAGE_BASE}:v<new-version>
```

`Dockerfile`은 multi-stage (builder → runtime, node:24-slim). Cloud Build이 알아서 build context 업로드 + 빌드 + push. 약 3~5분.

#### 4-2. Cloud Run 새 리비전 배포

```bash
gcloud run deploy ${SERVICE} \
  --region ${REGION} \
  --image ${IMAGE_BASE}:v<new-version>
```

이미지만 갱신하는 시그니처 — **env vars / secrets / service account / scaling annotations 등 기존 리비전 설정은 그대로 보존**. 새 설정을 같이 바꿀 거 아니면 추가 flag 금지(실수로 기존값 덮어쓰기 방지).

기존 설정 갱신이 필요하면 `gcloud run services update`를 따로 쓴다 — deploy 명령에 끼워넣지 말 것.

### 5. master 머지

배포가 prod에서 안정적으로 도는 거 확인되면 develop → master로 머지. master는 "현재 prod에 떠 있는 코드"의 기록.

### 6. 태그 (master 위에서)

```bash
git checkout master
git pull origin master
git tag v<new-version>
git push origin v<new-version>
```

태그는 prod와 실제로 매핑되는 master 커밋에만 박는다. develop에는 안 박음 — develop은 진행 중인 다음 릴리스라 태그 위치가 의미 없어짐.

## 검증

```bash
# 새 리비전이 100% 트래픽 받는지
gcloud run services describe ${SERVICE} --region ${REGION} \
  --format='value(status.traffic[].revisionName,status.traffic[].percent)'

# 새 이미지 태그가 실제로 올라갔는지
gcloud run services describe ${SERVICE} --region ${REGION} \
  --format='value(spec.template.spec.containers[0].image)'

# 헬스/메타 — RFC 9728 protected-resource 응답 200 + canonical resource 확인
curl -s https://mcp.todo-calendar.com/.well-known/oauth-protected-resource | jq
```

## 롤백

이전 리비전으로 트래픽 100% 라우팅.

```bash
gcloud run revisions list --service ${SERVICE} --region ${REGION} --limit 5
gcloud run services update-traffic ${SERVICE} \
  --region ${REGION} \
  --to-revisions <previous-revision-name>=100
```

새 리비전 자체는 남겨두고 트래픽만 빼는 게 안전 — 진짜 문제면 그 다음 리비전을 삭제.

## 주의

- **버전 동기화**: lib(`todocalendar-tools`)이랑 server 이미지 태그를 같은 SemVer로 맞춘다. 갈라지면 어느 server가 어느 lib API와 짝인지 추적 불가.
- **secrets 추가/변경**: Secret Manager에 secret을 먼저 만들고(`gcloud secrets create ...` + `gcloud secrets versions add ...`), 그다음 `gcloud run services update --update-secrets=KEY=secret-name:latest`. server 코드에서 신규 env를 *읽기 시작하기 전*에 prod 환경에 값을 박아둬야 startup이 안 깨짐.
- **publish는 immutable**: `npm publish` 한 번 나가면 같은 버전으로 재배포 불가 (unpublish는 72시간 한정 + 강한 제약). 잘못 나갔으면 patch 버전 올려서 다시.
- **roll-forward 우선**: prod 문제 발생 시 일반적으로 새 patch로 fix → 재배포가 표준. 롤백은 fix까지 시간이 더 걸릴 때만.
