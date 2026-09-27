# Button Game Studio

내가 가진 AI 계정으로, 버튼 한 번에 브라우저 게임을 만드는 로컬 오픈소스 스튜디오입니다. Codex CLI 또는 OpenAI, Gemini, Claude, Grok API를 고르고 게임 아이디어를 입력하면, 열 명의 전문 에이전트가 동시에 설계하고 선택한 AI가 완성된 단일 HTML 게임을 생성합니다.

## 주요 기능

- 게임 하나마다 게임 디자이너, 엔지니어, 아트 디렉터, 레벨 디자이너, UI 디자이너, 접근성 리뷰어, 사운드 디자이너, 프로그래머, QA 테스터, 프로듀서 역할의 에이전트 10개 실행
- Codex CLI의 내 로그인 또는 내 API 키로 OpenAI, Gemini, Claude, Grok 사용
- 제공자별 모델 선택과 사용자 지정 모델 ID 입력
- 생성 게임 바로 실행, 독립 `index.html` 다운로드, 이 기기의 게임 라이브러리에 보관
- 여러 게임을 하나의 `index.html` 아케이드 사이트로 합치기
- 게임 아케이드를 Cloudflare Pages 프로젝트로 배포
- 키와 게임 데이터는 로컬 기기에서만 처리

## 시작하기

필요 항목: Node.js 20 이상. Codex CLI를 사용하려면 CLI를 설치하고 개인 계정으로 로그인합니다.

```sh
npm install
npm start
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다.

### 내 AI 계정 연결

**Codex**: Codex CLI를 설치하고 `codex login`으로 본인 계정에 로그인합니다. `codex login status`로 상태를 확인할 수 있습니다. 생성할 때 Codex 탭을 선택하면 로컬 CLI가 사용자 로그인을 사용합니다. 서버나 앱에 OAuth 토큰을 저장하거나 내보내지 않습니다.

**OpenAI API, Gemini, Claude, Grok**: 해당 제공자의 개발자 콘솔에서 본인 API 키를 발급받아 생성 화면의 키 칸에 입력합니다. 키는 브라우저 탭 메모리에만 존재하고 로컬 앱 서버를 거쳐 선택한 제공자에 전달됩니다. 앱은 키를 파일, 브라우저 저장소, 로그에 기록하지 않습니다. 탭을 닫으면 입력한 키가 사라집니다. 10개 에이전트와 마지막 게임 생성에 같은 선택 모델과 키를 사용합니다.

한 게임을 만들 때 제공자 API 요청 11회가 발생합니다. 제공자 요금과 사용량 제한이 적용됩니다.

## 게임 사용과 배포

완성된 게임에서 **HTML 저장**을 눌러 독립 파일을 받거나, **게임 모음에 추가** 후 라이브러리에서 **index.html 저장**을 눌러 통합 아케이드를 받습니다. 게임은 네트워크 연결 없이 동작하도록 외부 라이브러리나 자산을 사용하지 않는 HTML로 생성합니다.

Cloudflare Pages 배포:

1. `npm install`로 Wrangler를 설치합니다.
2. 한 번만 `npx wrangler login`으로 본인 Cloudflare 계정에 로그인합니다.
3. Cloudflare Dashboard 또는 `npx wrangler pages project create <project-name> --production-branch main`으로 Pages 프로젝트를 준비합니다.
4. 이 앱의 **내 게임 모음**에 게임을 추가하고 프로젝트 이름을 넣어 **배포하기**를 누릅니다.

게임 모음은 `games/<project-name>/index.html`에도 저장됩니다. 같은 이름으로 다시 배포하면 업데이트됩니다. 앱은 `127.0.0.1`에서만 실행되므로 이 배포 버튼은 로컬 앱이 설치된 컴퓨터에서 사용합니다. AI 생성 스튜디오 자체는 사용자 API 키와 로컬 Codex 로그인이 필요해 Cloudflare에 바로 올리는 대상이 아니며, 완성한 게임과 게임 사이트를 Pages에 배포합니다.

## 모델 선택

제공자별 기본 모델 목록은 빠르게 시작하기 위한 제안입니다. 모델 제공 범위는 API 계정과 제공자의 현재 모델 상태에 따라 달라질 수 있습니다. **직접 입력…**을 골라 계정에서 사용할 수 있는 모델 ID를 지정할 수 있습니다.

## 데이터와 보안

- 서버는 `127.0.0.1`에만 바인딩합니다. `HOST`를 바꾸면 로컬 전용 보장은 달라집니다.
- API 키는 서버 요청 본문에서 메모리로만 처리됩니다. 저장, 출력, 로그 기록을 하지 않습니다.
- Codex는 사용자의 Codex CLI 로그인 상태를 쓰고, `codex exec --ephemeral --sandbox read-only`로 에이전트 요청을 실행합니다.
- 게임과 게임 모음은 현재 브라우저의 `localStorage`에 저장됩니다. 브라우저 데이터를 지우면 게임도 지워지므로 내보내기 파일을 보관하세요.
- 생성 HTML은 독립 실행을 위해 sandboxed iframe에서 미리 봅니다. 외부 라이브러리나 서버 코드를 실행하지 않습니다.

## 개발

```sh
npm run dev
```

## License

MIT. See [LICENSE](LICENSE).
