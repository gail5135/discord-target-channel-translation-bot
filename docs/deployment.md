# 배포 가이드 — GCP e2-micro

이 문서는 봇을 GCP e2-micro 인스턴스에 올려 24시간 돌리는 절차다. 로컬 실행 방법은 `README.md`를 본다.

## 0. 준비

- Discord Developer Portal에서 봇 애플리케이션이 만들어져 있고 토큰을 발급받았다
- **MESSAGE CONTENT INTENT**가 켜져 있다 (Bot 탭 → Privileged Gateway Intents). 없으면 메시지 내용 자체가 들어오지 않는다
- 봇이 서버에 초대되어 있다 (OAuth2 스코프 `bot`, `applications.commands`)
- DeepL 또는 Google Cloud Translation 중 최소 하나의 API 키가 있다

## 1. 인스턴스 생성

GCP Compute Engine에서 VM을 만든다.

| 항목 | 값 |
|---|---|
| 머신 타입 | `e2-micro` |
| 리전 | `us-west1` / `us-central1` / `us-east1` 중 하나 |
| 부팅 디스크 | Debian 12, 30GB 표준 영구 디스크 |

**리전이 셋으로 제한되는 이유**: Always Free 한도가 이 세 리전에서만 적용된다. 다른 리전을 고르면 과금된다.

**방화벽 규칙은 열지 않는다.** 봇은 디스코드 게이트웨이와 번역 API로 나가는 연결만 쓴다. 들어오는 포트가 필요 없다.

## 2. Node.js 22 설치

SSH로 접속한 뒤:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v    # v22.x 이상인지 확인
```

## 3. 저장소 clone

```bash
cd ~
git clone https://github.com/gail5135/discord-target-channel-translation-bot.git
cd discord-target-channel-translation-bot
```

## 4. 의존성 설치

```bash
npm ci
```

`npm ci`가 메모리 부족으로 죽으면 스왑을 잡고 다시 시도한다. e2-micro는 RAM이 약 1GB뿐이다:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. `.env` 작성

**`.env`는 저장소에 없다.** 자격증명이 들어가므로 `.gitignore` 대상이며, 서버에서 직접 만든다.

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | Developer Portal → Bot → Token |
| `DISCORD_CLIENT_ID` | Developer Portal → General Information → Application ID |
| `DISCORD_TEST_GUILD_ID` | 봇을 쓸 **서버(길드) ID**. 슬래시 커맨드 등록 대상이다 |
| `DEEPL_API_KEY` | 1순위 제공자. 무료 키는 `:fx`로 끝나며 엔드포인트는 코드가 자동 판별한다 |
| `GOOGLE_TRANSLATE_API_KEY` | 2순위 제공자 |

번역 API 키는 **둘 중 하나만 있어도 기동한다.** 둘 다 없으면 기동 즉시 종료된다.

`chmod 600`은 반드시 실행한다. 코드가 쓰는 `config.json`에는 자동으로 적용되지만 `.env`는 사람이 만드는 파일이다.

## 6. 슬래시 커맨드 등록

```bash
npm run deploy-commands
```

`Registered 1 command(s) to guild <id>` 가 나오면 성공이다.

**길드 단위 등록이다.** 즉시 반영된다(글로벌 등록은 최대 1시간). `DISCORD_TOKEN`·`DISCORD_CLIENT_ID`·`DISCORD_TEST_GUILD_ID` 셋이 모두 있어야 하며, 하나라도 비어 있으면 오류를 던지고 끝난다.

이 명령은 **커맨드 정의가 바뀌었을 때만** 다시 실행하면 된다. 봇을 재시작할 때마다 부를 필요는 없다.

## 7. pm2 설치와 기동

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 logs --lines 50
```

로그에 다음 두 줄이 보이면 정상이다:

```
[translation] providers: deepl -> google
Logged in as <봇이름>
```

(과거에는 이름 뒤에 `#숫자` discriminator가 붙었지만, discriminator가 `0`인 현행 계정은 접미사 없이 이름만 찍힌다. 레거시 계정이 아니면 이 형태가 정상이다.)

## 8. 로그 로테이션 (필수)

pm2는 기본적으로 로그를 무한히 쌓는다. 디스크 30GB를 채우면 죽는 것은 봇이 아니라 서버다 — 그 상태에서는 SSH 접속도 어려워진다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

`pm2-logrotate`는 pm2 자체 모듈이라 `package.json`과 무관하다.

## 9. 부팅 시 자동 시작

```bash
pm2 startup systemd
```

출력된 `sudo env PATH=... pm2 startup systemd -u ...` 명령을 그대로 복사해 실행한 뒤:

```bash
pm2 save
```

`pm2 save`를 빠뜨리면 재부팅 후 pm2는 뜨지만 봇은 뜨지 않는다.

## 10. 갱신 절차

```bash
cd ~/discord-target-channel-translation-bot
git pull
npm ci
pm2 restart discord-translation-bot
```

슬래시 커맨드 정의(`src/commands/setting.ts`의 `data`)가 바뀐 경우에만 추가로:

```bash
npm run deploy-commands
```

## 11. 롤백 절차

```bash
cd ~/discord-target-channel-translation-bot
git log --oneline -10          # 되돌릴 커밋 확인
git checkout <이전 커밋 해시>
npm ci
pm2 restart discord-translation-bot
```

`.env`와 `config.json`은 gitignore 대상이라 `git checkout`의 영향을 받지 않는다. 설정은 그대로 유지된다.

되돌린 뒤 `git checkout main`으로 복귀할 수 있다.

## 12. 배포 체크리스트

기동 직후 확인한다.

- [ ] Developer Portal에서 **MESSAGE CONTENT INTENT**가 켜져 있다
- [ ] 봇이 원본 채널에 **View Channel** 권한을 갖고 있다
- [ ] 봇이 출력 채널에 **View Channel / Send Messages / Manage Webhooks** 권한을 갖고 있다
- [ ] `ls -l .env`의 권한이 `-rw-------` (600)이다
- [ ] `pm2 logs`에 `[translation] providers: ...`와 `Logged in as ...`가 보인다
- [ ] `pm2 status`가 `online`이다
- [ ] `pm2 ls`에 `pm2-logrotate`가 보인다
- [ ] `pm2 save`를 실행했다
- [ ] 원본 채널에 메시지를 보내면 출력 채널에 **원 발신자 이름·아바타**로 게시된다
- [ ] `pm2 logs`에 메시지 본문이 남지 않는다

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| `pm2 status`가 `errored` | 아래 "크래시 루프에서 회복하기" 참고 |
| 슬래시 커맨드가 안 보임 | `npm run deploy-commands`를 실행했는지, `DISCORD_TEST_GUILD_ID`가 그 서버의 ID인지 |
| 메시지를 감지하지 못함 | MESSAGE CONTENT INTENT, 원본 채널의 View Channel 권한 |
| 봇 이름으로 게시됨 (원 발신자가 아니라) | 출력 채널의 Manage Webhooks 권한 |
| 같은 메시지가 두 번 게시됨 | 봇이 두 곳에서 돌고 있다. 로컬에서도 켜뒀는지 확인한다 |
| 디스크가 찼다 | `pm2 install pm2-logrotate`를 빠뜨렸다. 8절을 실행하고 `pm2 flush`로 기존 로그를 비운다 |

### 크래시 루프에서 회복하기

60초를 못 버틴 기동이 5번 반복되면 pm2는 포기하고 `errored` 상태로 남는다(`ecosystem.config.js`의 `min_uptime`/`max_restarts`). 순서대로:

1. **먼저 원인을 고친다.** `pm2 logs --err`로 확인한다. `.env` 누락이나 번역 API 키 부재가 대부분이다.
2. **재시작 카운터를 초기화한다.** `pm2 restart`는 카운터를 초기화하지 않는다 — pm2 공식 문서가 안내하는 방법은 `pm2 reset discord-translation-bot`이다. 그 다음 `pm2 restart discord-translation-bot`을 실행한다.
3. **그래도 `errored`에 머무르면 확실한 방법을 쓴다.** `pm2 delete discord-translation-bot`으로 앱 등록 자체를 지우면 앱별 상태(재시작 카운터 포함)가 함께 사라진다. 이어서 `pm2 start ecosystem.config.js`로 다시 등록한다.
