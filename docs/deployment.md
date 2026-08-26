# 배포 가이드: GCP e2-micro

이 문서는 봇을 GCP e2-micro 인스턴스에 올려서 24시간 동안 돌리는 절차를 설명한다. 로컬에서 실행하는 방법은 `README_KR.md`를 본다. `README.md`는 언어를 선택하는 페이지이므로 내용이 들어 있지 않다.

## 0. 준비

- Discord Developer Portal에서 봇 애플리케이션을 만들었고 토큰을 발급받았다
- **MESSAGE CONTENT INTENT**를 켜 두었다(Bot 탭의 Privileged Gateway Intents에서 설정한다). 이 인텐트가 없으면 메시지 내용 자체가 봇으로 들어오지 않는다
- 봇을 서버에 초대해 두었다(OAuth2 스코프는 `bot`과 `applications.commands`이다)
- DeepL과 Google Cloud Translation 중에서 최소한 하나의 API 키를 확보했다

## 1. 인스턴스

두 가지 경우가 있다. **이 봇은 실제로 B의 방식으로 배포되어 있으며**, 기존에 다른 디스코드 봇이 돌고 있던 인스턴스에 함께 올렸다.

### A. 새 인스턴스를 만드는 경우

GCP Compute Engine에서 VM을 만든다.

| 항목 | 값 |
|---|---|
| 머신 타입 | `e2-micro` |
| 리전 | `us-west1`과 `us-central1`, `us-east1` 중 하나 |
| 부팅 디스크 | Debian 12, 30GB 표준 영구 디스크 |

**리전이 셋으로 제한되는 이유**: Always Free 한도가 이 세 리전에서만 적용되기 때문이다. 다른 리전을 고르면 과금된다.

**방화벽 규칙은 열지 않는다.** 봇은 디스코드 게이트웨이와 번역 API로 나가는 연결만 사용하므로, 들어오는 포트가 필요하지 않다.

**Always Free로 쓸 수 있는 e2-micro는 계정당 한 대뿐이다.** 두 번째 인스턴스를 만들면 과금되며, 이것이 아래 B를 택하게 되는 실질적인 이유이다.

### B. 기존 인스턴스에 함께 올리는 경우

봇 두 개를 한 인스턴스에서 돌리면 **RAM과 디스크, egress, pm2 설정이 전부 공유 자원**이 된다. 새로 올리는 봇이 기존 봇을 밀어낼 수 있다는 뜻이므로, 올리기 전에 현재 상태를 먼저 확인한다.

```bash
pm2 ls                    # 이미 돌고 있는 앱과 각각의 메모리
free -m                   # 남은 RAM, 스왑 설정 여부
df -h /                   # 남은 디스크
pm2 conf pm2-logrotate    # 로그 로테이션이 이미 설정돼 있는지
```

| 공유 자원 | 확인할 것 |
|---|---|
| **RAM (약 1GB)** | 기존 앱의 `mem` 값을 모두 더한 다음, 이 봇이 사용하는 약 45MB가 들어갈 여유가 있는지 본다. 여유가 얇으면 4절의 스왑을 반드시 잡는다 |
| **디스크 (30GB)** | 로그가 두 배로 쌓이므로 9절의 로테이션이 더욱 중요해진다 |
| **월 egress 1GB** | 두 봇이 나누어 쓴다. 이 봇이 내보내는 것은 번역된 텍스트뿐이라 차지하는 몫이 작지만, 한도는 인스턴스가 아니라 **프로젝트 단위**로 집계된다 |
| **pm2 전역 설정** | `pm2-logrotate`는 앱별로 적용되지 않고 **pm2 전체**에 적용된다. 9절을 참고한다 |

**두 봇 모두 컴파일된 JS로 돌고 있다.** `pm2 ls`의 `mem` 열에서 실측한 값은 다음과 같다.

| 앱 | RSS |
|---|---|
| `discord-forum-tracker` | 51.9MB |
| `discord-translation-bot` | 44.5MB |

두 값을 합치면 약 100MB이므로, RAM이 약 1GB인 환경에서 여유가 있다.

**앞으로 이 인스턴스에는 ts-node로 직접 실행하는 앱을 얹지 않는다.** ts-node는 TypeScript 컴파일러를 프로세스에 상주시키기 때문에 RSS를 약 290MB 더 사용한다(실측값은 369MB와 80MB이다). 그런 앱을 한 대만 얹어도 위에서 확인한 여유가 사라지며, 밀려나는 쪽이 새로 올린 앱이 아니라 **이미 돌고 있던 봇**일 수 있다. 이 봇을 컴파일 실행으로 바꾼 이유가 바로 그것이다(5절을 참고한다).

새 앱을 올리기 전에 그 앱이 무엇으로 도는지 확인한다.

```bash
pm2 describe <앱-이름> | grep -E "script path|script args"
```

`script path`가 `dist/...`를 가리키면 컴파일된 JS를 실행하는 것이고, `ts-node`나 `npm`을 가리키면 그렇지 않다.

**저장소의 `npm start`를 그대로 믿으면 안 된다.** `discord-forum-tracker`의 저장소는 `npm start`가 `ts-node src/index.ts`를 실행하도록 되어 있지만, 서버에는 빌드한 뒤 `dist`를 실행하도록 등록되어 있다. 위에서 확인한 51.9MB가 그 증거인데, ts-node로 돌고 있었다면 300MB대가 나왔을 것이다. 그 봇을 다시 등록하거나 다른 서버로 옮길 때 `npm start`를 쓰면 실행 방식이 조용히 바뀌게 된다.

**두 봇은 서로 다른 디렉토리에 clone한다.** pm2는 `ecosystem.config.js`의 `name`에 적힌 앱 이름으로 구분하므로, 이름만 겹치지 않으면 된다. 이 봇의 이름은 `discord-translation-bot`이다.

## 2. Node.js 22 설치

SSH로 접속한 다음 실행한다.

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

`npm ci`가 메모리 부족으로 종료되면 스왑을 잡고 다시 시도한다. e2-micro는 RAM이 약 1GB뿐이며, **다른 봇이 이미 돌고 있다면 쓸 수 있는 여유가 그만큼 더 좁아진다.**

스왑이 이미 잡혀 있는지 먼저 확인하고, 잡혀 있다면 이 절을 건너뛴다.

```bash
swapon --show
```

잡혀 있지 않다면 다음과 같이 만든다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. 빌드

TypeScript를 컴파일해서 `dist/`를 만든다. **`dist`는 저장소에 포함되어 있지 않으므로 서버에서 직접 빌드해야 한다.**

```bash
npm run build
```

`dist/index.js`가 생기면 성공이다. pm2는 이 파일을 실행한다.

빌드한 산출물을 실행하는 이유는 메모리 때문이다. ts-node로 TypeScript를 직접 실행하면 TypeScript 컴파일러가 프로세스에 상주하기 때문에 RSS가 **약 290MB** 더 든다(실측값이다). RAM이 1GB인 e2-micro에서는 이 차이가 결정적으로 작용한다. 그 대신 코드를 고칠 때마다 빌드를 한 번씩 실행해야 한다.

`npm run build` 역시 메모리를 사용하지만 배포하는 시점에 한 번만 실행하며, 4절의 스왑이 잡혀 있으면 문제가 되지 않는다.

## 6. `.env` 작성

**`.env`는 저장소에 포함되어 있지 않다.** 자격증명이 들어가기 때문에 `.gitignore` 대상이며, 서버에서 직접 만들어야 한다.

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

| 변수 | 내용 |
|---|---|
| `DISCORD_TOKEN` | Developer Portal의 Bot 탭에 있는 Token이다 |
| `DISCORD_CLIENT_ID` | Developer Portal의 General Information에 있는 Application ID이다 |
| `DISCORD_GUILD_ID` | 봇을 사용할 **서버(길드)의 ID**이며, 슬래시 커맨드를 등록하는 대상이다 |
| `DEEPL_API_KEY` | 1순위 제공자이다. 무료 키는 `:fx`로 끝나며, 어느 엔드포인트를 쓸지는 코드가 자동으로 판별한다 |
| `GOOGLE_TRANSLATE_API_KEY` | 2순위 제공자이다 |

번역 API 키는 **둘 중 하나만 있어도 기동한다.** 둘 다 없으면 기동하는 즉시 종료된다.

`chmod 600`은 반드시 실행한다. 코드가 직접 쓰는 `config.json`에는 이 권한이 자동으로 적용되지만, `.env`는 사람이 만드는 파일이기 때문이다.

## 7. 슬래시 커맨드 등록

```bash
npm run deploy-commands
```

`Registered 1 command(s) to guild <id>`가 출력되면 성공이다.

이 명령도 `dist/`를 실행하므로 **5절의 빌드가 먼저 끝나 있어야 한다.**

**길드 단위로 등록하기 때문에** 즉시 반영된다. 글로벌로 등록하면 반영되기까지 최대 한 시간이 걸린다. `DISCORD_TOKEN`과 `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` 세 가지가 모두 있어야 하며, 하나라도 비어 있으면 오류를 던지고 종료한다.

이 명령은 **커맨드 정의가 바뀌었을 때만** 다시 실행하면 된다. 봇을 재시작할 때마다 실행할 필요는 없다.

## 8. pm2 설치와 기동

```bash
sudo npm install -g pm2      # 이미 깔려 있으면 건너뛴다
pm2 start ecosystem.config.js
pm2 logs discord-translation-bot --lines 50
```

`pm2 start`는 기존 앱을 건드리지 않고 **앱을 하나 추가한다.** `pm2 ls`에 두 줄이 보이면 정상이다.

**`pm2 restart all`이나 `pm2 logs`를 앱 이름 없이 실행하지 않는다.** 같은 인스턴스의 다른 봇까지 재시작되거나, 로그가 뒤섞여서 읽기 어려워진다. 이 문서의 모든 pm2 명령은 앱 이름을 명시하고 있다.

로그에 다음 두 줄이 보이면 정상이다.

```
[translation] providers: deepl -> google
Logged in as <봇이름>
```

과거에는 이름 뒤에 `#숫자` 형태의 discriminator가 붙었지만, discriminator가 `0`인 현행 계정은 접미사 없이 이름만 출력된다. 레거시 계정이 아니라면 이 형태가 정상이다.

## 9. 로그 로테이션 (필수)

pm2는 기본적으로 로그를 무한히 쌓는다. 디스크 30GB를 모두 채우면 죽는 것은 봇이 아니라 서버이며, 그 상태에서는 SSH로 접속하기도 어려워진다. 봇이 둘이면 로그가 쌓이는 속도도 두 배가 된다.

**`pm2-logrotate`는 앱별 설정이 아니라 pm2 전역 모듈이다.** 이미 설정되어 있는데 아래 명령을 그대로 실행하면 **기존 봇의 로그 정책까지 덮어쓰게 된다.** 그러므로 현재 값을 먼저 확인한다.

```bash
pm2 conf pm2-logrotate
```

이미 설치하고 설정해 두었다면 그대로 두거나, 봇이 둘로 늘어난 만큼 보관량을 조정할지만 판단한다. 설치되어 있지 않다면 다음과 같이 설정한다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

`pm2-logrotate`는 pm2 자체 모듈이므로 `package.json`과는 무관하다.

## 10. 부팅 시 자동 시작

```bash
pm2 startup systemd
```

출력된 `sudo env PATH=... pm2 startup systemd -u ...` 명령을 그대로 복사해서 실행한 다음, 아래 명령을 실행한다.

```bash
pm2 save
```

`pm2 save`를 빠뜨리면 재부팅한 뒤에 pm2는 뜨지만 봇은 뜨지 않는다.

**`pm2 save`는 실행한 시점의 앱 목록 전체를 스냅샷으로 덮어쓴다.** 기존 봇이 `pm2 ls`에 정상적으로 떠 있는 상태에서 실행해야 한다. 기존 봇을 잠시 `pm2 delete`로 지워 둔 채 저장하면, 재부팅한 뒤에 그 봇이 사라진다.

## 11. 갱신 절차

```bash
cd ~/discord-target-channel-translation-bot
git pull
npm ci
npm run build
pm2 restart discord-translation-bot
```

**`npm run build`를 빠뜨리면 pm2가 예전 `dist/`를 계속 실행한다.** 코드를 받아왔는데 동작이 그대로라면 이 점을 먼저 의심한다.

슬래시 커맨드 정의, 즉 `src/commands/setting.ts`의 `data`가 바뀐 경우에만 다음 명령을 추가로 실행한다.

```bash
npm run deploy-commands
```

## 12. 롤백 절차

```bash
cd ~/discord-target-channel-translation-bot
git log --oneline -10          # 되돌릴 커밋 확인
git checkout <이전 커밋 해시>
npm ci
npm run build
pm2 restart discord-translation-bot
```

`.env`와 저장소 루트의 `config.json`은 gitignore 대상이라 `git checkout`의 영향을 받지 않으므로, 설정은 그대로 유지된다. `dist/` 역시 gitignore 대상이므로 반드시 다시 빌드해야 한다.

되돌린 다음에는 `git checkout main`으로 복귀할 수 있다.

## 13. 배포 체크리스트

기동한 직후에 확인한다.

- [ ] Developer Portal에서 **MESSAGE CONTENT INTENT**를 켜 두었다
- [ ] 봇이 원본 채널에 **View Channel** 권한을 갖고 있다
- [ ] 봇이 출력 채널에 **View Channel**과 **Send Messages**, **Manage Webhooks** 권한을 갖고 있다
- [ ] `ls -l .env`로 확인한 권한이 `-rw-------`(600)이다
- [ ] `pm2 logs`에 `[translation] providers: ...`와 `Logged in as ...`가 보인다
- [ ] `dist/index.js`가 존재한다(`npm run build`를 실행했다)
- [ ] `pm2 ls`에서 이 봇과 **기존 봇이 둘 다** `online` 상태이다
- [ ] `pm2 ls`의 `mem` 합계에 여유가 있다(`free -m`으로 교차 확인한다)
- [ ] `pm2 ls`에 `pm2-logrotate`가 보인다(기존 설정을 덮어쓰지 않았다)
- [ ] `pm2 save`를 실행했다(기존 봇이 목록에 있는 상태에서 실행했다)
- [ ] 원본 채널에 메시지를 보내면 출력 채널에 **원 발신자의 이름과 아바타**로 게시된다
- [ ] `pm2 logs`에 메시지 본문이 남지 않는다

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| `pm2 status`가 `errored`이다 | 아래의 "크래시 루프에서 회복하기"를 참고한다 |
| 슬래시 커맨드가 보이지 않는다 | `npm run deploy-commands`를 실행했는지, `DISCORD_GUILD_ID`가 그 서버의 ID가 맞는지 확인한다 |
| 메시지를 감지하지 못한다 | MESSAGE CONTENT INTENT와 원본 채널의 View Channel 권한을 확인한다 |
| 원 발신자가 아니라 봇 이름으로 게시된다 | 출력 채널의 Manage Webhooks 권한을 확인한다 |
| 같은 메시지가 두 번 게시된다 | 봇이 두 곳에서 돌고 있는 것이다. 로컬에서도 켜 두었는지 확인한다 |
| 디스크가 찼다 | `pm2 install pm2-logrotate`를 빠뜨린 것이다. 9절을 실행하고 `pm2 flush`로 기존 로그를 비운다 |
| 봇이 주기적으로 재시작된다 | `pm2 ls`에서 `restart` 횟수와 `mem`을 확인한다. `max_memory_restart: 250M`에 걸리는 것이라면 누수가 있거나, 같은 인스턴스의 다른 앱에 밀려서 여유가 없는 것이다 |
| **다른 봇이** 죽거나 느려졌다 | 이 봇을 올린 다음에 생긴 일이라면 원인은 RAM이다. `free -m`과 `pm2 ls`의 `mem`을 확인하고, 스왑이 없으면 4절을 실행해서 잡는다 |

### 크래시 루프에서 회복하기

60초를 버티지 못한 기동이 5번 반복되면 pm2는 재시작을 포기하고 `errored` 상태로 남겨 둔다. 이것은 `ecosystem.config.js`의 `min_uptime`과 `max_restarts` 설정에 따른 동작이다. 다음 순서대로 처리한다.

1. **먼저 원인을 고친다.** `pm2 logs --err`로 확인한다. `.env`가 없거나 번역 API 키가 하나도 없는 경우가 대부분이다.
2. **재시작 카운터를 초기화한다.** `pm2 restart`는 카운터를 초기화하지 않으며, pm2 공식 문서가 안내하는 방법은 `pm2 reset discord-translation-bot`이다. 그 다음에 `pm2 restart discord-translation-bot`을 실행한다.
3. **그래도 `errored` 상태에 머무르면 확실한 방법을 쓴다.** `pm2 delete discord-translation-bot`으로 앱 등록 자체를 지우면 재시작 카운터를 포함한 앱별 상태가 함께 사라진다. 이어서 `pm2 start ecosystem.config.js`로 다시 등록한다.
