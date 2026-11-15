# MCP 등재 런치 — Product Hunt + Show HN 동시 게시 자료

- 작성: 2026-11-16, mcp 세션 (PM 할당) · 이슈 [#90](https://github.com/sudopark/TodoCalendar-mcp/issues/90)
- 상위 설계: PM `docs/plans/2026-11-13-remote-notification-and-mcp-listing-design.md` §W5 "등재 공개 홍보"
- 게시는 **사용자 계정에서 사용자가 직접** 한다. 이 문서는 그대로 복사해 쓰는 답안지다.

커넥터는 2026-11-15에 Claude 디렉토리 승인·게시됐다 (`claude.ai/directory/connectors/todo-calendar`, Community, "신규" 배지). 승인을 기다릴 게 없으니 런치는 자료가 준비되는 대로 나간다.

> **메시지 범위 제약 (PM §W5):** 이번 홍보는 지금 MCP가 하는 것 — AI로 일정·할 일 관리 — 만 말한다. **서버 알림은 언급하지 않는다.** 알림은 3.3.0 출시 홍보(2차) 몫이다. 앱 내장 "AI 빠른 입력"과 이번 Claude 커넥터는 다른 기능이니 섞어 쓰지 않는다.

## 1. 런치 날짜와 시각표

**2026-11-20 (목) 하루에 Product Hunt + Show HN을 묶는다.**

목요일로 잡은 이유는 셋이다. Product Hunt는 화~목 트래픽이 가장 두텁고, 금요일 런치는 24시간 랭킹 구간이 주말로 넘어가 후속 트래픽이 꺼진다. Show HN도 미국 평일 오전이 가장 잘 뜬다. 디렉토리 "신규" 배지가 붙어 있는 동안 쏘는 게 유입에 유리하고, 12/12 데드라인·3.3.0 2차 홍보와도 3주 간격이 벌어져 채널 피로가 없다.

Product Hunt 런치는 태평양 시간 00:01에 열려 24시간 랭킹을 돈다. 한국 시간으로 환산한 시각표:

| KST | 할 일 |
| --- | --- |
| 11/20 (목) 17:01 | **PH 런치 오픈.** 예약 게시가 자동으로 열린다. 열린 걸 눈으로 확인한다 |
| 11/20 17:10 | PH 메이커 코멘트를 첫 댓글로 올린다 (§2.6) |
| 11/20 17:30 | X(일본어·한국어) 포스트, 앱 내 공지 (§4) |
| 11/20 22:00 | **Show HN 게시** (미국 동부 08:00 — HN 오전 피크). 글은 §3 |
| 11/20 22:00~24:00 | HN 댓글 대응. 첫 2시간이 프런트페이지 진입을 가른다 |
| 11/21 (금) 01:00~09:00 | PH 댓글 대응. 미국 활동 시간대다. 자다 깨서 볼 필요는 없고 아침에 몰아 답해도 된다 |
| 11/21 09:00 | Reddit r/mcp·r/ClaudeAI 게시 (§4). PH/HN 반응을 보고 문구를 조정해 올린다 |
| 11/21 17:00 | PH 랭킹 마감. 순위·업보트·유입 기록 |
| 11/21~11/23 | MCP 디렉토리 사이트 등재 (§4.4), note·Zenn 기사 |

대안 날짜가 필요하면 **11/19 (수)** 가 차선이다 (준비 하루 줄어듦). 11/21(금)·주말은 피한다.

준비 마감: **11/19 (수) 밤까지 이미지 5장**(§2.5)이 있어야 11/20 예약 게시를 걸 수 있다. 이미지가 안 되면 날짜를 미룬다 — 이미지 없는 PH 런치는 유입이 안 난다.

## 2. Product Hunt

### 2.1 무엇을 런치하는가

제품은 **To-do Calendar** (앱)이고, Claude 커넥터를 "새로 생긴 것"으로 앞세운다. PH는 제품 단위로 돌아가는 곳이라 커넥터만 떼어 올리면 "쓸 수 있는 제품"으로 안 읽힌다. 앱을 올리고 커넥터를 신규성으로 쓰는 쪽이 설치까지 이어진다.

### 2.2 기본 필드

| 필드 | 값 |
| --- | --- |
| Name | To-do Calendar |
| Links | `https://todo-calendar.com` / App Store `https://apps.apple.com/app/id6639620385` / 커넥터 `https://claude.ai/directory/connectors/todo-calendar` |
| Topics (최대 3) | Productivity, Calendar, Artificial Intelligence |
| Pricing | Free (with in-app purchases) |
| Launch tags | 포털이 제시하는 목록에서 AI / Productivity 계열 |

### 2.3 Tagline (60자 제한)

**추천:** `Manage your Google and Apple calendars from Claude` (50자)

광고에서 설치로 가장 잘 이어진 "갈아타지 않는 달력"(쓰던 캘린더 그대로)과 "Claude에서 말로"를 한 줄에 같이 넣은 안이다. 대안:

- `Keep your calendar. Run it from Claude.` (39자) — 더 짧고 세지만 무슨 앱인지가 덜 보인다
- `Your schedules and to-dos, one calendar, now in Claude` (54자) — 앱 자체 가치가 앞서고 커넥터가 뒤로 간다

### 2.4 Description

포털 폼의 글자 제한이 260자인지 500자인지 안내가 엇갈린다. **260자 이내 버전을 기본으로 넣고**, 폼이 500자를 받으면 긴 버전으로 바꾼다.

아래 두 블록은 읽기 좋게 줄을 나눠 놨다. **폼에는 줄바꿈을 지우고 한 문단으로 붙여넣는다.** 글자 수는 줄바꿈 없는 상태 기준이다.

260자 버전 (253자):

```
Schedules and to-dos on one calendar, synced with the Google and Apple
calendars you already use. Now it connects to Claude: ask what's on this week,
add a repeating event, finish a to-do — in plain language, with nothing to
migrate and no form to fill.
```

500자 버전 (492자):

```
Schedules and to-dos on one calendar, synced with the Google and Apple
calendars you already use — nothing to migrate, nothing to leave behind. Now it
connects to Claude: ask what's on this week, add a repeating event, move a
meeting, finish a to-do, all in plain language. Recurrence is expanded on the
server, so "every third Thursday" or a lunar date comes back with the dates it
actually falls on. Deletes take two steps, so the assistant has to show you what
it is about to remove first.
```

### 2.5 이미지

| 자리 | 스펙 | 내용 |
| --- | --- | --- |
| Thumbnail | 240×240 PNG | 앱 아이콘. `todo-calendar.com/logo-light.png`를 리사이즈 (불투명 흰 배경 — 다크모드 대응은 1.0.2에서 이미 처리) |
| Gallery 1 | 1270×760 | **Claude 채팅 + 결과.** 왼쪽에 "Add a team sync every third Thursday at 10am" 대화, 오른쪽에 그 일정이 들어간 앱 캘린더. 한 장으로 제품을 설명하는 장이라 여기에 제일 공들인다 |
| Gallery 2 | 1270×760 | **할 일 + 일정 한 달력.** 앱 월간 화면. 미완료 할 일이 최상단에 남아 있는 게 보이게 |
| Gallery 3 | 1270×760 | **쓰던 캘린더 그대로.** 구글 캘린더 다중 계정 연동 화면 — 계정별 색이 그대로 살아 있는 걸 보여준다 |
| Gallery 4 | 1270×760 | **반복 일정.** 날짜만 고르면 규칙이 조립되는 화면 (매월 3째 목요일 / 음력) |
| Gallery 5 | 1270×760 | **2단계 삭제.** Claude가 삭제 전에 무엇을 지울지 보여주고 확인을 기다리는 화면 |

갤러리 1·5는 새로 찍어야 한다. 2·3·4는 App Store 스크린샷에서 가져와 1270×760에 맞춰 재배치하면 된다. 각 장 상단에 영어 한 줄 캡션을 올린다 (PH는 이미지를 넘기며 읽는 사람이 많다).

### 2.6 메이커 코멘트 (첫 댓글)

```
Hi HN— wait, wrong site. Hi Product Hunt 👋

I build To-do Calendar, a calendar app for iPhone and the web. I made it because
I was tired of looking in two places: the calendar for what's happening, a to-do
app for what isn't done yet. So both live on one calendar here, and unfinished
to-dos don't get stranded on a past date — they stay at the top until you check
them off.

The other thing I kept hearing is that nobody wants to migrate a calendar. So
To-do Calendar doesn't ask you to. You connect the Google accounts you already
have (several at once, colours and attendees and meeting links intact) and your
iPhone's Apple calendar, and if you ever disconnect, nothing of yours is
deleted.

What's new today is the Claude connector. Once it's added, you can run the whole
thing by talking: what's on this week, add a repeating event, move it an hour
later, mark it done, tag it. 30 tools, read and write.

Two details I'd want to know as a user:

- Recurrence is expanded on my server, not guessed by the model. "Every third
  Thursday", month-end skips, leap years, lunar dates — the assistant gets back
  the dates each occurrence actually falls on.
- Deleting takes two steps. The first call changes nothing; it returns a
  confirmation the assistant has to show you, and only a second call with that
  token deletes. I didn't want a model one token away from clearing a calendar.

It's free with in-app purchases, the connector is in the Claude directory, and
the server is open source: github.com/sudopark/TodoCalendar-mcp

Happy to answer anything — I'm the only one working on this, so you're talking
to the person who wrote the bug you found.
```

첫 줄 농담("wrong site")은 같은 날 Show HN을 같이 쏘기 때문에 쓴 것이다. HN을 안 쏘는 날로 바뀌면 지운다.

### 2.7 댓글 대응 준비

| 질문 | 답 |
| --- | --- |
| Android는? | 지금은 iPhone과 웹이다. 웹은 브라우저에서 바로 쓸 수 있다 (`todo-calendar.com`) |
| 다른 AI에서도 되나? | 서버가 표준 MCP라 Streamable HTTP를 받는 클라이언트면 붙는다. 공식 MCP 레지스트리에도 올라가 있다. ChatGPT 앱 디렉토리는 요건이 더 많아 다음 과제로 뺐다 |
| 내 캘린더 데이터를 당신이 보나 | 커넥터는 To-do Calendar API 앞에 선 얇은 어댑터고, 자체 저장소가 없다. 뒤에 서드파티도 없다. OAuth로 승인한 본인 계정에만 동작하고, 유저 신원은 검증된 토큰에서만 읽는다 (tool 인자로 받지 않는다) |
| 유료는 뭐가 다른가 | (사용자가 현재 인앱 구성에 맞게 한 줄로 채운다 — 이 문서에서 단정하지 않는다) |
| Google Tasks도 되나 | 지금은 캘린더 연동이다. 할 일은 To-do Calendar 안에서 관리한다 (일본 App Store 리뷰에 같은 요청이 있었으니 받아 적을 질문이다) |

## 3. Show HN

### 3.1 제목 (80자 이내 관행)

**추천:** `Show HN: To-do Calendar MCP – run your calendar from Claude` (59자)

대안: `Show HN: An MCP server for my calendar app, with two-step deletes` (65자) — 기술 쪽 호감은 더 사지만 제품이 뭔지 덜 보인다.

링크는 **GitHub 레포** `https://github.com/sudopark/TodoCalendar-mcp` 로 간다. HN 공식 Show HN 규칙이 랜딩페이지를 제외하고 "실제로 써볼 수 있는 것"을 요구하는데, 레포는 코드가 보이고 README에 연결 절차가 있어 둘을 같이 만족한다. 느낌표·최상급은 쓰지 않는다 (제목에서 바로 걸린다).

### 3.2 본문

```
I write a calendar app for iPhone and the web (To-do Calendar), and this is the
MCP server that lets an assistant drive it. It's live in the Claude directory as
of this week, and the server code is in the repo.

The app's own premise is that you shouldn't have to migrate: it reads the Google
accounts and the iPhone calendar you already have, and puts schedules and
unfinished to-dos on the same calendar. The MCP server exposes that same data —
30 tools, read and write: to-dos, schedules, tags, event details, the pinned
event, and the awkward parts of recurring events (edit one occurrence, skip one,
split a series from a date onward).

Three decisions that took the most time:

Recurrence is expanded server-side. Early on I let the model reason about "every
third Thursday" and it was wrong often enough to be useless — month-end skips,
leap years and Korean/Japanese lunar dates especially. Now there are two tools
that return occurrences as concrete dates, and the model never computes a date
itself. Same for absolute times: inputs are ISO 8601 with an offset and the
server converts, because models are bad at epoch arithmetic and good at
calendars.

Deletes are two calls. delete_todo and delete_schedule don't delete on the first
call — they return a confirmation token plus a human-readable message, and only
a second call with that token goes through. Tokens last 5 minutes and are bound
to the user, the tool and the arguments, so they can't be replayed on a
different target. It costs a round trip and I'd make the same trade again; the
failure mode on the other side is a cleared calendar.

The user identity never comes from a tool argument. It's read from the verified
access token's sub, so a model that decides to pass someone else's user id gets
ignored. OAuth 2.1 with DCR and PKCE, and the token's audience is bound to this
server's canonical URI.

The thing I got wrong and had to redo: the first version shipped full JSON
output schemas in tools/list, which was 68% of the payload before the model had
even picked a tool. That's now a describe_tool meta-tool you call when you
actually need the detail.

Repo: https://github.com/sudopark/TodoCalendar-mcp
Connector: https://claude.ai/directory/connectors/todo-calendar
App: https://todo-calendar.com

It's one person's app, so the honest limits: iPhone and web only (no Android),
the connector needs an account, and server-sent notifications aren't in yet —
reminders you set through the connector are stored but the app still schedules
them locally. That's the next thing I'm building.
```

마지막 단락은 **알림을 "아직 안 된다"로만** 적는다. PM §W5가 이번 홍보에서 알림을 홍보 소재로 쓰지 말라고 했는데, HN에서 한계를 숨기면 댓글에서 더 비싸게 치인다. "못 하는 것"으로 적는 건 홍보가 아니라 고지다.

### 3.3 댓글 대응 준비

HN은 첫 2시간 댓글 품질이 랭킹을 가른다. 짧고 사실만, 방어적으로 쓰지 않는다.

| 올 질문 | 답할 거리 |
| --- | --- |
| "왜 MCP를 쓰나, API면 되지" | 커넥터 이전엔 앱 안에 자체 AI 입력이 있었다. MCP는 유저가 이미 쓰는 어시스턴트에서 같은 데이터를 쓰게 하는 경로다. 서버는 openAPI 앞의 얇은 어댑터고 비즈니스 로직이 없다 |
| "2단계 삭제는 UX 낭비 아닌가" | 파괴적 10종 중 2종에만 걸었다. 나머지는 confirm 없이 간다. 되돌릴 수 있는 write에는 안 건다 |
| prompt injection | tool 결과의 user-controlled 텍스트를 wrapping한다 (#59). 유저 신원은 토큰에서만 읽어서, 인자로 남의 id를 밀어넣는 경로는 없다 |
| "30개는 너무 많다" | tools/list는 요약만 싣고 상세는 describe_tool로 뺐다. 그래도 많은 건 맞고, 묶을 만한 쌍이 있는지 보고 있다 |
| 가격·라이선스 | 서버 코드는 레포에 있고, 앱은 무료 + 인앱결제 |
| 셀프호스팅 | npm `todocalendar-tools`로 tool 레이어를 직접 import할 수 있다. 다만 뒤의 API는 To-do Calendar 계정이 필요하다 |

## 4. 그 외 무료 채널

### 4.1 Reddit — 11/21 (금), PH/HN 반응 본 뒤

자기홍보 규칙이 서브마다 다르다. **올리기 전에 각 서브 사이드바 규칙을 읽는다.** 링크만 던지면 지워지고 계정이 걸린다.

- **r/mcp** — 제일 맞는 자리. 제목 `To-do Calendar MCP — 30 tools over a calendar app, with server-side recurrence expansion`. 본문은 §3.2를 줄여서. 기술 얘기를 앞에
- **r/ClaudeAI** — 제목 `I put my calendar app in the Claude directory — ask it what's on this week`. 커넥터 사용 경험 중심, 스크린샷 1장
- **r/productivity** — 규칙이 가장 엄격하다. 제품 소개로 쓰지 않고 "일정과 할 일을 한 달력에 두는 방식" 글로 쓰고 앱은 마지막 한 줄에만. 무리면 건너뛴다
- **r/iosapps / r/apple** — 앱 쪽. iOS 3.1.3 위젯·테마가 더 통하는 소재다

### 4.2 X — 11/20 (목) 17:30, PH 오픈 직후

일본이 우선 시장이라 **일본어를 먼저** 올리고 한국어를 따로 올린다 (한 포스트에 두 언어 섞지 않는다). 광고로 이미 도는 "갈아타지 않는 달력" 문구를 그대로 쓴다.

일본어:

```
Claudeから予定を入れられるようになりました。

「来週の木曜10時に歯医者」と話すだけ。GoogleカレンダーもAppleカレンダーも
そのまま、乗り換えなしで。

To-do Calendar のコネクタが Claude ディレクトリに公開されました。
claude.ai/directory/connectors/todo-calendar

Product Hunt にも出しています 👇
```

한국어:

```
Claude에서 말로 일정을 넣을 수 있게 됐습니다.

"다음 주 목요일 10시 치과" 라고 말하면 끝. 쓰던 구글·애플 캘린더 그대로,
갈아타지 않고요.

To-do Calendar 커넥터가 Claude 디렉토리에 공개됐습니다.
claude.ai/directory/connectors/todo-calendar
```

### 4.3 일본 채널 — 11/21~23

- **note.com** — 일본 생산성 독자층이 두텁다. "乗り換えないカレンダー" 를 축으로 개발 이야기 기사 1편. 기능 나열보다 왜 만들었나가 읽힌다
- **Zenn** — 기술 쪽. MCP 서버 구현 기사 (서버사이드 반복 전개, 2단계 삭제, OAuth 2.1 RS). §3.2를 일본어로 풀면 된다. Zenn은 제품 홍보에 민감하니 구현 얘기로 쓰고 제품은 각주로
- 일본 App Store 리뷰에 "Google 캘린더와 Google Tasks를 같이 관리하고 싶었다"는 요청이 이미 있다. 일본 문구는 그 수요에 붙인다

### 4.4 MCP 디렉토리 사이트 — 11/21~23, 심사 없음

공식 레지스트리(`com.todo-calendar/todo-calendar`)에는 이미 올라가 있다. 서드파티 디렉토리는 별도 등재가 필요하고 전부 무료다. 각 사이트의 제출 폼을 확인해 `server.json` 정보로 채운다.

- pulsemcp.com
- glama.ai/mcp/servers
- smithery.ai
- mcpservers.org

### 4.5 앱 내 공지 / 스토어 — 11/20

- 앱 내 공지에 커넥터 공개를 올린다 (iOS 앱의 공지 채널 — head 세션 소관이라 PM 경유로 요청)
- App Store "이벤트" 또는 업데이트 설명에 커넥터 한 줄. **단, 3.1.3 설명을 지금 갈아엎지 않는다** — 3.3.0 제출 때 알림과 함께 묶는 게 심사 한 번으로 끝난다

## 5. 체크리스트

### D-4 ~ D-1 (11/16 월 ~ 11/19 수)

- [ ] 갤러리 이미지 5장 (§2.5). 1·5번은 새로 캡처, 2·3·4는 App Store 스크린샷 재배치
- [ ] 썸네일 240×240 (로고 리사이즈)
- [ ] PH 계정 확인 — 런치 전 계정 활동 이력이 없으면 스팸으로 걸러질 수 있다. 며칠 전부터 다른 제품에 업보트·댓글을 남겨 둔다
- [ ] PH 폼의 실제 Description 글자 제한 확인 → 260자/500자 버전 중 선택 (§2.4)
- [ ] 태그라인·설명 최종 확정 (§2.3, §2.4)
- [ ] 메이커 코멘트에서 "유료는 뭐가 다른가" 답 한 줄 채우기 (§2.7)
- [ ] Show HN 본문의 링크 3개 동작 확인
- [ ] 커넥터를 **깨끗한 계정에서 한 번 더** 연결해 본다 — 런치 트래픽이 들어오는 날 OAuth가 막히면 그날이 끝난다
- [ ] prod `/health`·커넥터 응답 확인. Cloud Run 최소 인스턴스가 0이면 콜드스타트가 리뷰 첫인상을 깎는다. 런치 당일만 1로 올릴지 판단
- [ ] 11/19 밤: PH 런치 **예약 게시** 등록 (11/20 00:01 PST)

### D-day (11/20 목)

- [ ] 17:01 PH 오픈 확인
- [ ] 17:10 메이커 코멘트 게시 (§2.6)
- [ ] 17:30 X 일본어 → 한국어 포스트 (§4.2)
- [ ] 22:00 Show HN 게시 (§3)
- [ ] 22:00~24:00 HN 댓글 대응 (§3.3)
- [ ] PH 링크를 Show HN 댓글에 넣지 않는다. 교차 홍보는 HN에서 역효과다

### D+1 ~ D+3 (11/21 금 ~ 11/23 일)

- [ ] 09:00 PH 댓글 몰아 대응 (§2.7)
- [ ] r/mcp, r/ClaudeAI 게시 (§4.1) — 서브 규칙 먼저 읽기
- [ ] MCP 디렉토리 4곳 등재 (§4.4)
- [ ] note·Zenn 기사 (§4.3)
- [ ] 17:00 PH 랭킹 마감 후 기록: 순위, 업보트, 코멘트 수
- [ ] 유입 측정 — 커넥터 신규 연결 수(MCP 호출 로깅 #63), App Store 일본·미국 다운로드, 레포 star
- [ ] 결과 한 줄로 PM 보고. 2차(3.3.0) 홍보에 쓸 교훈 정리

## 6. 측정

런치 성과는 PH 순위가 아니라 **커넥터 신규 연결 수**로 본다. 등재 홍보의 목적이 설치·연결이지 순위가 아니다.

| 지표 | 출처 |
| --- | --- |
| 커넥터 신규 연결 / unique user | MCP 호출 로깅 (#63) |
| App Store 다운로드 (일본·미국 분리) | App Store Connect |
| 레포 star / npm 다운로드 | GitHub, npmjs |
| 채널별 유입 | PH·HN·Reddit 각 플랫폼 지표 |

베이스라인을 **11/19에 미리 찍어 둔다.** 런치 뒤에 재면 증분을 모른다.
